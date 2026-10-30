"""O filtro de escopo decide antes de executar o agente ou ferramentas."""

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI

from app.main import app
from app.services import chat_service
from app.services.game_scope import OUT_OF_SCOPE_REPLY


@pytest.fixture
def scope_transport(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    decisions = []
    sent = []

    def handler(request):
        body = json.loads(request.content)
        sent.append(body)
        label = decisions.pop(0)
        return httpx.Response(200, json={
            "id": "resp_scope", "object": "response", "created_at": 1,
            "model": "test-model", "status": "completed", "error": None,
            "incomplete_details": None, "instructions": None,
            "output": [{"id": "msg_scope", "type": "message", "role": "assistant",
                        "status": "completed", "content": [
                            {"type": "output_text", "text": label, "annotations": []},
                        ]}],
            "parallel_tool_calls": False, "tools": [], "tool_choice": "auto",
        })

    def make_client(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    monkeypatch.setattr(chat_service, "AsyncOpenAI", make_client)
    return decisions, sent


@pytest.mark.parametrize("message,history", [
    ("Faça um gráfico sobre S&P 500", []),
    ("Últimos 10 anos", [
        {"role": "user", "content": "Faça um gráfico sobre S&P 500"},
        {"role": "assistant", "content": "Qual período deseja ver?"},
    ]),
    ("Quanto valem as ações da Nintendo?", [
        {"role": "user", "content": "Quero jogos para Switch."},
    ]),
])
def test_unrelated_request_is_refused_before_agent(scope_transport, monkeypatch, message, history):
    decisions, sent = scope_transport
    decisions.append("FORA")

    async def unexpected_run(*args, **kwargs):
        pytest.fail("O agente não deve executar pedidos fora do escopo")

    monkeypatch.setattr(chat_service.Runner, "run", unexpected_run)
    with TestClient(app) as client:
        response = client.post("/api/chat", json={
            "conversation_id": str(uuid4()), "message": message, "history": history,
        })
    assert response.status_code == 200
    assert response.json()["message"]["content"] == OUT_OF_SCOPE_REPLY
    assert len(sent) == 1
    assert sent[0]["store"] is False
    assert sent[0]["max_output_tokens"] == 128
    scope_input = json.loads(sent[0]["input"][0]["content"])
    assert scope_input["current_message"] == message
    assert scope_input["history"] == history


@pytest.mark.parametrize("message,history", [
    ("Como funciona o cooperativo em Portal 2?", []),
    ("No PC", [
        {"role": "user", "content": "Quero um jogo cooperativo."},
        {"role": "assistant", "content": "Em qual plataforma?"},
    ]),
])
def test_game_request_reaches_agent(scope_transport, monkeypatch, message, history):
    decisions, sent = scope_transport
    decisions.append("JOGOS")
    calls = []

    async def fake_run(*args, **kwargs):
        calls.append(kwargs["input"])
        return SimpleNamespace(final_output="Posso ajudar com jogos.")

    monkeypatch.setattr(chat_service.Runner, "run", fake_run)
    with TestClient(app) as client:
        response = client.post("/api/chat", json={
            "conversation_id": str(uuid4()), "message": message, "history": history,
        })
    assert response.status_code == 200
    assert response.json()["message"]["content"] == "Posso ajudar com jogos."
    assert len(sent) == len(calls) == 1
    assert calls[0][-1] == {"role": "user", "content": message}


def test_unknown_scope_decision_fails_closed(scope_transport, monkeypatch):
    decisions, _ = scope_transport
    decisions.append("TALVEZ")

    async def unexpected_run(*args, **kwargs):
        pytest.fail("Uma decisão desconhecida não libera o agente")

    monkeypatch.setattr(chat_service.Runner, "run", unexpected_run)
    with TestClient(app) as client:
        response = client.post("/api/chat", json={
            "conversation_id": str(uuid4()), "message": "Uma pergunta qualquer",
        })
    assert response.status_code == 502
