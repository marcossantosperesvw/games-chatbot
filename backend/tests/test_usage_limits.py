"""Admissão determinística por processo e contrato HTTP sem provedores reais."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.api import chat as chat_api
from app.api.schemas import AssistantMessage
from app.core.errors import AIProviderError
from app.core.usage_limits import ChatAdmission, UsageLimitError, UsageSettings, get_usage_settings
from app.main import app


class Clock:
    def __init__(self):
        self.seconds = 1000.0
        self.wall = datetime(2026, 11, 19, 23, 59, 30, tzinfo=UTC)

    def advance(self, seconds):
        self.seconds += seconds
        self.wall += timedelta(seconds=seconds)


def controller(**settings):
    clock = Clock()
    admission = ChatAdmission(UsageSettings(**settings), clock=lambda: clock.seconds, utcnow=lambda: clock.wall)
    return admission, clock


def assert_limit(function, code, status, retry=None):
    with pytest.raises(UsageLimitError) as error:
        function()
    assert error.value.code == code
    assert error.value.status_code == status
    assert error.value.headers["X-Chat-Error"] == code
    if retry is not None:
        assert error.value.headers["Retry-After"] == str(retry)


def test_context_limit_is_inclusive_and_does_not_consume_admission():
    admission, _ = controller(max_context_characters=4, requests_per_minute=1)
    admission.validate_context(4)
    assert_limit(lambda: admission.validate_context(5), "context_limit", 413)
    with admission.admit("client"):
        pass


def test_rate_limit_uses_sliding_monotonic_window_and_separate_clients():
    admission, clock = controller(requests_per_minute=2)
    with admission.admit("A"):
        pass
    clock.advance(10)
    with admission.admit("A"):
        pass
    assert_limit(lambda: admission.acquire("A"), "rate_limit", 429, 50)
    with admission.admit("B"):
        pass
    clock.wall -= timedelta(days=1)  # Hora civil não altera a janela monotônica.
    assert_limit(lambda: admission.acquire("A"), "rate_limit", 429, 50)
    clock.advance(50)
    with admission.admit("A"):
        pass  # Exatamente 60 segundos: a primeira entrada expirou.
    assert_limit(lambda: admission.acquire("A"), "rate_limit", 429, 10)


def test_daily_limit_is_shared_across_clients_and_resets_at_utc_midnight():
    admission, clock = controller(max_requests_per_day=2)
    for client in ("A", "B"):
        with admission.admit(client):
            pass
    assert_limit(lambda: admission.acquire("C"), "daily_limit", 429, 30)
    clock.advance(30)
    with admission.admit("C"):
        pass


@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
def test_error_and_cancellation_release_capacity_but_keep_consumed_quota(failure):
    admission, _ = controller(max_concurrent_requests=1, requests_per_minute=1)
    with pytest.raises(failure):
        with admission.admit("A"):
            raise failure()
    with admission.admit("B"):
        pass
    assert_limit(lambda: admission.acquire("A"), "rate_limit", 429)


def test_capacity_rejection_does_not_consume_rate_or_daily_quota():
    admission, _ = controller(max_concurrent_requests=1, requests_per_minute=1, max_requests_per_day=2)
    admission.acquire("A")
    assert_limit(lambda: admission.acquire("B"), "capacity_limit", 503, 1)
    admission.release()
    with admission.admit("B"):
        pass
    assert_limit(lambda: admission.acquire("C"), "daily_limit", 429)


def test_client_tracking_is_bounded_without_evicting_active_windows(monkeypatch):
    monkeypatch.setattr("app.core.usage_limits.MAX_TRACKED_CLIENTS", 2)
    admission, clock = controller(requests_per_minute=1)
    for client in ("A", "B"):
        with admission.admit(client):
            pass
    assert_limit(lambda: admission.acquire("C"), "rate_limit", 429, 60)
    assert_limit(lambda: admission.acquire("A"), "rate_limit", 429, 60)
    clock.advance(60)
    with admission.admit("C"):
        pass
    with admission.admit("D"):
        pass


def test_concurrent_threads_cannot_overbook_capacity():
    admission, _ = controller(max_concurrent_requests=2)
    barrier = Barrier(8)

    def reserve(number):
        barrier.wait(timeout=5)
        try:
            admission.acquire(str(number))
            return "accepted"
        except UsageLimitError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=8) as pool:
        outcomes = list(pool.map(reserve, range(8)))
    assert outcomes.count("accepted") == 2
    assert outcomes.count("capacity_limit") == 6
    admission.release()
    admission.release()


@pytest.mark.parametrize("name,value", [
    ("CHAT_MAX_CONTEXT_CHARACTERS", "0"),
    ("CHAT_MAX_CONTEXT_CHARACTERS", "204001"),
    ("CHAT_REQUESTS_PER_MINUTE", "invalid"),
    ("CHAT_MAX_CONCURRENT_REQUESTS", "0"),
    ("CHAT_MAX_REQUESTS_PER_DAY", "-1"),
])
def test_invalid_configuration_fails_closed_without_echoing_value(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(RuntimeError, match="Configuração dos limites") as error:
        get_usage_settings()
    assert name not in str(error.value)


def test_config_reads_all_four_environment_options(monkeypatch):
    monkeypatch.setenv("CHAT_MAX_CONTEXT_CHARACTERS", "12000")
    monkeypatch.setenv("CHAT_REQUESTS_PER_MINUTE", "3")
    monkeypatch.setenv("CHAT_MAX_CONCURRENT_REQUESTS", "1")
    monkeypatch.setenv("CHAT_MAX_REQUESTS_PER_DAY", "20")
    assert get_usage_settings() == UsageSettings(max_context_characters=12000,
        requests_per_minute=3, max_concurrent_requests=1, max_requests_per_day=20)


@pytest.fixture
def api(monkeypatch):
    admission, clock = controller()
    monkeypatch.setattr(app.state, "chat_admission", admission, raising=False)
    for name in ("catalog", "knowledge", "videos"):
        monkeypatch.setattr(app.state, name, None, raising=False)
    calls = []

    async def reply(request, **kwargs):
        calls.append(request)
        return AssistantMessage(content="Resposta simulada.")

    monkeypatch.setattr(chat_api, "generate_reply", reply)
    return SimpleNamespace(admission=admission, clock=clock, calls=calls)


def payload(**fields):
    return {"conversation_id": str(uuid4()), "message": "Olá", **fields}


async def post(body, *, host="192.0.2.1", headers=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(host, 1234)),
                                 base_url="http://test") as client:
        return await client.post("/api/chat", json=body, headers=headers)


def test_api_counts_stripped_unicode_and_rejects_context_before_ai(api, monkeypatch):
    admission, _ = controller(max_context_characters=4, requests_per_minute=1)
    monkeypatch.setattr(app.state, "chat_admission", admission)

    async def scenario():
        rejected = await post(payload(message=" 🎮🎮🎮 ", history=[{"role": "user", "content": " 🎮🎮 "}]))
        assert rejected.status_code == 413
        assert rejected.headers["X-Chat-Error"] == "context_limit"
        assert not api.calls
        accepted = await post(payload(message=" 🎮🎮 ", history=[{"role": "user", "content": " 🎮🎮 "}]))
        assert accepted.status_code == 200
        assert len(api.calls) == 1
        assert api.calls[0].message == "🎮🎮"

    asyncio.run(scenario())


def test_api_ignores_forged_forwarded_headers_and_exposes_error_headers(api, monkeypatch):
    admission, _ = controller(requests_per_minute=1)
    monkeypatch.setattr(app.state, "chat_admission", admission)

    async def scenario():
        assert (await post(payload())).status_code == 200
        rejected = await post(payload(), headers={"Origin": "http://localhost:3000",
                                                 "X-Forwarded-For": "198.51.100.2"})
        assert rejected.status_code == 429
        assert rejected.headers["X-Chat-Error"] == "rate_limit"
        assert rejected.headers["Retry-After"] == "60"
        assert rejected.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
        exposed = {name.strip().lower() for name in rejected.headers["Access-Control-Expose-Headers"].split(",")}
        assert {"x-chat-error", "retry-after"} <= exposed
        assert (await post(payload(), host="198.51.100.2")).status_code == 200
        assert len(api.calls) == 2

    asyncio.run(scenario())


def test_api_provider_failure_consumes_daily_budget_and_releases_capacity(api, monkeypatch):
    admission, _ = controller(max_requests_per_day=1, max_concurrent_requests=1)
    monkeypatch.setattr(app.state, "chat_admission", admission)

    async def fail(request, **kwargs):
        api.calls.append(request)
        raise AIProviderError()

    monkeypatch.setattr(chat_api, "generate_reply", fail)

    async def scenario():
        assert (await post(payload())).status_code == 502
        rejected = await post(payload(), host="198.51.100.2")
        assert rejected.status_code == 429
        assert rejected.headers["X-Chat-Error"] == "daily_limit"
        assert rejected.headers["Retry-After"] == "30"
        assert len(api.calls) == 1

    asyncio.run(scenario())


def test_api_capacity_is_released_when_handler_is_cancelled(api, monkeypatch):
    admission, _ = controller(max_concurrent_requests=1)
    monkeypatch.setattr(app.state, "chat_admission", admission)

    async def scenario():
        entered = asyncio.Event()
        finished = asyncio.Event()

        async def slow(request, **kwargs):
            api.calls.append(request)
            entered.set()
            await finished.wait()
            return AssistantMessage(content="Resposta simulada.")

        monkeypatch.setattr(chat_api, "generate_reply", slow)
        pending = asyncio.create_task(post(payload()))
        await asyncio.wait_for(entered.wait(), timeout=2)
        rejected = await post(payload(), host="198.51.100.2")
        assert rejected.status_code == 503
        assert rejected.headers["X-Chat-Error"] == "capacity_limit"
        assert rejected.headers["Retry-After"] == "1"
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        finished.set()
        assert (await post(payload(), host="198.51.100.2")).status_code == 200
        assert len(api.calls) == 2

    asyncio.run(scenario())
