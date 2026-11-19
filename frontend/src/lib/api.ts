import type { ChatRequest, ChatResponse } from "@/types/chat";
import { isVideoList } from "./videos.ts";
import { isStoreLinkList } from "./store-links.ts";

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

function isChatResponse(value: unknown): value is ChatResponse {
  if (typeof value !== "object" || value === null) return false;
  if (!("conversation_id" in value) || !("message" in value)) return false;

  const message = value.message;
  return (
    typeof value.conversation_id === "string" &&
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant" &&
    "content" in message &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    isVideoList("videos" in message ? message.videos : undefined) &&
    isStoreLinkList("store_links" in message ? message.store_links : undefined)
  );
}

export async function sendChatMessage(
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const timeout = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new Error("O servidor demorou para responder. Tente novamente.");
    }
    throw new Error(
      "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
    );
  }

  if (!response.ok) {
    const errorCode = response.headers.get("X-Chat-Error");
    const retryAfter = response.headers.get("Retry-After");
    const retrySeconds = retryAfter && /^\d{1,5}$/.test(retryAfter)
      ? Number(retryAfter) : null;
    const wait = retrySeconds !== null && retrySeconds > 0 && retrySeconds <= 86_400
      ? ` Aguarde ${retrySeconds} segundos antes de tentar novamente.`
      : " Aguarde um pouco antes de tentar novamente.";
    if (response.status === 413) {
      throw new Error(
        "A mensagem e o histórico juntos ultrapassam o limite de contexto do chat. Reduza sua mensagem ou inicie uma nova conversa; o histórico não foi alterado.",
      );
    }
    if (response.status === 429) {
      if (errorCode === "daily_limit") {
        throw new Error("O limite diário de mensagens do chat foi atingido. O limite é renovado às 00:00 UTC; tente novamente após a renovação.");
      }
      throw new Error(`Muitas mensagens em pouco tempo.${wait}`);
    }
    if (response.status === 422) {
      throw new Error(
        "A mensagem ou o histórico não atende aos limites do chat. Revise o texto ou inicie uma nova conversa.",
      );
    }
    if (response.status === 503) {
      if (errorCode === "capacity_limit") {
        throw new Error(`O chat está ocupado com outras solicitações.${wait}`);
      }
      throw new Error("A inteligência artificial está indisponível. Verifique a configuração do backend.");
    }
    if (response.status === 504) {
      throw new Error("A inteligência artificial demorou para responder. Tente novamente.");
    }
    throw new Error("Não foi possível processar a mensagem. Tente novamente.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new Error("O servidor demorou para responder. Tente novamente.");
    }
    throw new Error("O servidor retornou uma resposta inválida. Tente novamente.");
  }

  if (!isChatResponse(data) || data.conversation_id !== request.conversation_id) {
    throw new Error("O servidor retornou uma resposta inválida. Tente novamente.");
  }

  return data;
}
