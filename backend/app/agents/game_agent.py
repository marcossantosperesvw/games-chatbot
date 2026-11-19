"""Configuração do agente; comportamento editável no Markdown ao lado deste módulo."""

from dataclasses import dataclass
from pathlib import Path

from agents import Agent, FunctionTool, ModelSettings, OpenAIResponsesModel
from openai import AsyncOpenAI

from app.core.config import AISettings
from app.core.errors import AIConfigurationError
from app.tools.catalog import MAX_CATALOG_CALLS, CatalogContext, search_games
from app.tools.knowledge import search_knowledge
from app.tools.videos import search_videos


INSTRUCTIONS_PATH = Path(__file__).resolve().with_suffix(".md")


@dataclass(frozen=True)
class AgentCapabilities:
    """Uma única fonte para ferramentas disponíveis e orçamento de rodadas."""

    catalog: bool
    knowledge: bool
    videos: bool

    @property
    def tool_limits(self) -> tuple[tuple[FunctionTool, int], ...]:
        return tuple(
            (tool, limit)
            for enabled, tool, limit in (
                (self.catalog, search_games, MAX_CATALOG_CALLS),
                (self.knowledge, search_knowledge, 2),
                (self.videos, search_videos, 1),
            )
            if enabled
        )

    @property
    def max_turns(self) -> int:
        # Cada rodada pode consultar uma ferramenta; reservar a resposta final.
        return 1 + sum(limit for _, limit in self.tool_limits)

    def instructions(self) -> str:
        return "\n\n## Capacidades desta requisição\n" + "\n".join((
            "Este estado é definido pelo backend e prevalece sobre instruções que pressupõem ferramentas disponíveis.",
            ("Catálogo: search_games disponível, até duas consultas; uma consulta ainda pode falhar."
             if self.catalog else
             "Catálogo indisponível: não recomende títulos como confirmados nem forneça links de compra; explique a limitação."),
            ("RAG: search_knowledge disponível, até duas consultas."
             if self.knowledge else
             "Base RAG indisponível: informe a limitação quando precisar de evidência documental; conceitos gerais podem ser explicados como conhecimento do modelo."),
            ("Vídeos: search_videos disponível com autorização, até uma consulta."
             if self.videos else
             "Busca de vídeos indisponível nesta requisição: não há autorização ou integração ativa; não prometa pesquisa ou reprodução nem invente resultados."),
            "Use somente as ferramentas listadas nesta requisição. Não tente chamar ferramentas ausentes.",
        ))


def load_instructions() -> str:
    """Ler a versão salva em UTF-8 a cada criação do agente, sem cache ou fallback."""
    try:
        instructions = INSTRUCTIONS_PATH.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        raise AIConfigurationError() from None
    if not instructions:
        raise AIConfigurationError()
    return instructions


def create_game_agent(
    settings: AISettings, client: AsyncOpenAI, *, capabilities: AgentCapabilities,
) -> Agent[CatalogContext]:
    return Agent(
        name="Chat Jogos",
        instructions=load_instructions() + capabilities.instructions(),
        model=OpenAIResponsesModel(model=settings.model, openai_client=client),
        model_settings=ModelSettings(
            max_tokens=settings.max_output_tokens, store=False, parallel_tool_calls=False,
        ),
        tools=[tool for tool, _ in capabilities.tool_limits],
    )
