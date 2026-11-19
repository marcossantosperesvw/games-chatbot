"""Admissão local do chat: sem fila, persistência ou chamadas a provedores.

Os contadores pertencem a um processo. Reiniciar o processo os reinicia;
vários workers/instâncias não compartilham estes limites.
"""

import math
import os
import threading
import time
from collections import deque
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Callable, Iterator

from pydantic import BaseModel, Field, ValidationError


RATE_WINDOW_SECONDS = 60
MAX_TRACKED_CLIENTS = 1024


class UsageSettings(BaseModel):
    max_context_characters: int = Field(default=24_000, ge=1, le=204_000)
    requests_per_minute: int = Field(default=6, ge=1, le=1000)
    max_concurrent_requests: int = Field(default=2, ge=1, le=100)
    max_requests_per_day: int = Field(default=200, ge=1, le=100_000)


def get_usage_settings() -> UsageSettings:
    try:
        return UsageSettings(
            max_context_characters=os.getenv("CHAT_MAX_CONTEXT_CHARACTERS", "24000"),
            requests_per_minute=os.getenv("CHAT_REQUESTS_PER_MINUTE", "6"),
            max_concurrent_requests=os.getenv("CHAT_MAX_CONCURRENT_REQUESTS", "2"),
            max_requests_per_day=os.getenv("CHAT_MAX_REQUESTS_PER_DAY", "200"),
        )
    except ValidationError:
        # Configuração inválida não deve iniciar um servidor sem proteção.
        raise RuntimeError("Configuração dos limites do chat inválida.") from None


class UsageLimitError(Exception):
    def __init__(self, status_code: int, detail: str, code: str, retry_after: int | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.retry_after = retry_after

    @property
    def headers(self) -> dict[str, str]:
        headers = {"X-Chat-Error": self.code}
        if self.retry_after is not None:
            headers["Retry-After"] = str(self.retry_after)
        return headers


class ChatAdmission:
    def __init__(self, settings: UsageSettings, *, clock: Callable[[], float] = time.monotonic,
                 utcnow: Callable[[], datetime] = lambda: datetime.now(UTC)):
        self.settings = settings
        self._clock = clock
        self._utcnow = utcnow
        self._lock = threading.Lock()
        self._clients: dict[str, deque[float]] = {}
        self._day = utcnow().astimezone(UTC).date()
        self._accepted_today = 0
        self._active = 0

    def validate_context(self, character_count: int) -> None:
        if character_count > self.settings.max_context_characters:
            raise UsageLimitError(
                413,
                "A pergunta e o histórico excedem o limite de contexto do chat. "
                "Inicie uma nova conversa ou reduza a pergunta. Nenhuma mensagem foi cortada.",
                "context_limit",
            )

    def acquire(self, client_key: str) -> None:
        # A seção é curta e não contém await: contadores e reserva são atômicos,
        # inclusive se testes ou chamadas futuras usarem threads diferentes.
        with self._lock:
            now = self._clock()
            wall_time = self._utcnow().astimezone(UTC)
            if wall_time.date() != self._day:
                self._day, self._accepted_today = wall_time.date(), 0

            for key, timestamps in list(self._clients.items()):
                while timestamps and timestamps[0] <= now - RATE_WINDOW_SECONDS:
                    timestamps.popleft()
                if not timestamps:
                    del self._clients[key]

            if self._accepted_today >= self.settings.max_requests_per_day:
                midnight = datetime.combine(wall_time.date() + timedelta(days=1), datetime.min.time(), UTC)
                raise UsageLimitError(429, "O limite diário do chat foi atingido. Tente novamente no próximo dia UTC.",
                                      "daily_limit", max(1, math.ceil((midnight - wall_time).total_seconds())))

            timestamps = self._clients.get(client_key)
            if timestamps and len(timestamps) >= self.settings.requests_per_minute:
                wait = max(1, math.ceil(timestamps[0] + RATE_WINDOW_SECONDS - now))
                raise UsageLimitError(429, "Muitas mensagens em pouco tempo. Aguarde antes de tentar novamente.",
                                      "rate_limit", wait)
            if timestamps is None and len(self._clients) >= MAX_TRACKED_CLIENTS:
                # Não expulsar clientes ativos: isso permitiria contornar a taxa.
                wait = max(1, math.ceil(min(values[-1] for values in self._clients.values())
                                        + RATE_WINDOW_SECONDS - now))
                raise UsageLimitError(429, "O controle de acesso está ocupado. Aguarde antes de tentar novamente.",
                                      "rate_limit", wait)
            if self._active >= self.settings.max_concurrent_requests:
                raise UsageLimitError(503, "O chat está ocupado. Aguarde uma resposta terminar e tente novamente.",
                                      "capacity_limit", 1)

            if timestamps is None:
                timestamps = self._clients[client_key] = deque()
            timestamps.append(now)
            self._accepted_today += 1
            self._active += 1

    def release(self) -> None:
        with self._lock:
            if self._active <= 0:
                raise RuntimeError("Não há requisição de chat reservada para liberar.")
            self._active -= 1

    @contextmanager
    def admit(self, client_key: str) -> Iterator[None]:
        self.acquire(client_key)
        try:
            yield
        finally:
            # Erro, timeout e cancelamento não devolvem cotas já consumidas,
            # pois o provedor pode ter cobrado, mas sempre liberam concorrência.
            self.release()
