"""Ferramentas e turnos dependem das capacidades efetivas, sem consultas reais."""

import asyncio
import json
from itertools import product
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import httpx
from openai import AsyncOpenAI

from app.agents.game_agent import AgentCapabilities, create_game_agent, load_instructions
from app.api.schemas import ChatRequest
from app.core.config import AISettings
from app.core.errors import AIConfigurationError
from app.services import chat_service


FLAGS = list(product((False, True), repeat=3))


@pytest.mark.parametrize("catalog,knowledge,videos", FLAGS)
def test_agent_exposes_only_available_tools_and_reserves_final_turn(catalog, knowledge, videos):
    capabilities = AgentCapabilities(catalog=catalog, knowledge=knowledge, videos=videos)
    expected = []
    if catalog:
        expected.append(("search_games", 2))
    if knowledge:
        expected.append(("search_knowledge", 2))
    if videos:
        expected.append(("search_videos", 1))
    assert [(tool.name, limit) for tool, limit in capabilities.tool_limits] == expected
    assert capabilities.max_turns == 1 + sum(limit for _, limit in expected)
    agent = create_game_agent(
        AISettings(api_key="fake-key", model="fake-model"),
        SimpleNamespace(),
        capabilities=capabilities,
    )
    assert [tool.name for tool in agent.tools] == [name for name, _ in expected]
    assert agent.instructions.startswith(load_instructions())
    assert "Capacidades" in agent.instructions
    dynamic = capabilities.instructions()
    assert ("Catálogo: search_games disponível" in dynamic) is catalog
    assert ("Catálogo indisponível" in dynamic) is (not catalog)
    assert ("RAG: search_knowledge disponível" in dynamic) is knowledge
    assert ("Base RAG indisponível" in dynamic) is (not knowledge)
    assert ("Vídeos: search_videos disponível" in dynamic) is videos
    assert ("Busca de vídeos indisponível" in dynamic) is (not videos)


@pytest.mark.parametrize("catalog,knowledge,videos", FLAGS)
@pytest.mark.parametrize("consent", [False, True])
def test_service_uses_effective_capabilities_not_just_video_consent(
    monkeypatch, catalog, knowledge, videos, consent,
):
    monkeypatch.setenv("OPENAI_API_KEY", "fake-key")
    monkeypatch.setenv("OPENAI_MODEL", "fake-model")
    monkeypatch.setattr(chat_service, "is_game_related", AsyncMock(return_value=True))
    observed = []

    async def run(agent, **kwargs):
        observed.append((agent, kwargs))
        return SimpleNamespace(final_output="Posso ajudar com jogos.")

    monkeypatch.setattr(chat_service.Runner, "run", run)
    response = asyncio.run(chat_service.generate_reply(
        ChatRequest(conversation_id=uuid4(), message="Olá", include_videos=consent),
        catalog=SimpleNamespace() if catalog else None,
        knowledge=SimpleNamespace() if knowledge else None,
        videos=SimpleNamespace() if videos else None,
    ))
    agent, args = observed[0]
    assert response.content == "Posso ajudar com jogos."
    names = {tool.name for tool in agent.tools}
    assert ("search_games" in names) is catalog
    assert ("search_knowledge" in names) is knowledge
    assert ("search_videos" in names) is (videos and consent)
    assert args["max_turns"] == 1 + 2 * catalog + 2 * knowledge + (videos and consent)


def test_invalid_instructions_fail_before_scope_provider_call(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "fake-key")
    monkeypatch.setenv("OPENAI_MODEL", "fake-model")
    scope = AsyncMock(return_value=True)
    monkeypatch.setattr(chat_service, "is_game_related", scope)

    def invalid(*args, **kwargs):
        raise AIConfigurationError()

    monkeypatch.setattr(chat_service, "create_game_agent", invalid)
    with pytest.raises(AIConfigurationError):
        asyncio.run(chat_service.generate_reply(ChatRequest(conversation_id=uuid4(), message="Olá")))
    scope.assert_not_awaited()


@pytest.mark.parametrize("catalog,knowledge,videos", FLAGS)
def test_real_sdk_completes_every_available_tool_budget_then_final_reply(
    monkeypatch, catalog, knowledge, videos,
):
    """O SDK percorre as ferramentas reais; somente o transporte externo é falso."""
    monkeypatch.setenv("OPENAI_API_KEY", "fake-key")
    monkeypatch.setenv("OPENAI_MODEL", "fake-model")
    monkeypatch.setattr(chat_service, "is_game_related", AsyncMock(return_value=True))
    turns = []
    if catalog:
        turns.extend([("search_games", {"query": "Portal", "platform": None,
                                       "genre": None, "game_mode": None})] * 2)
    if knowledge:
        turns.extend([("search_knowledge", {"query": "Controles Steam", "game": None,
                                           "platform": None, "game_version": None,
                                           "product": None})] * 2)
    if videos:
        turns.append(("search_videos", {"query": "Configurar Steam"}))
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        position = len(sent) - 1
        if position < len(turns):
            name, arguments = turns[position]
            output = [{"type": "function_call", "id": f"fc_{position}",
                       "call_id": f"call_{position}", "name": name,
                       "arguments": json.dumps(arguments), "status": "completed"}]
        else:
            output = [{"id": "msg_final", "type": "message", "role": "assistant",
                       "status": "completed", "content": [{"type": "output_text",
                       "text": "Consulta concluída.", "annotations": []}]}]
        return httpx.Response(200, json={
            "id": f"resp_{position}", "object": "response", "created_at": 1,
            "model": "fake-model", "status": "completed", "error": None,
            "incomplete_details": None, "instructions": None, "output": output,
            "parallel_tool_calls": False, "tools": [], "tool_choice": "auto",
        })

    def client(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    monkeypatch.setattr(chat_service, "AsyncOpenAI", client)
    # Uma falha de catálogo consome tentativa, mas não remove o turno de resposta final.
    from app.catalog.errors import CatalogProviderError

    async def unavailable_catalog(params):
        raise CatalogProviderError()

    result = asyncio.run(chat_service.generate_reply(
        ChatRequest(conversation_id=uuid4(), message="Configurar controles", include_videos=True),
        catalog=SimpleNamespace(search=unavailable_catalog) if catalog else None,
        knowledge=SimpleNamespace(search=AsyncMock(return_value=[])) if knowledge else None,
        videos=SimpleNamespace(search=AsyncMock(return_value=())) if videos else None,
    ))
    assert result.content == "Consulta concluída."
    assert len(sent) == len(turns) + 1
