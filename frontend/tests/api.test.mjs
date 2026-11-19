import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000///";
const { sendChatMessage } = await import("../src/lib/api.ts");
const request = {
  conversation_id: "550e8400-e29b-41d4-a716-446655440000",
  message: "Quero jogar com amigos.",
  history: [],
};
const reply = {
  conversation_id: request.conversation_id,
  message: { role: "assistant", content: "Resposta simulada." },
};

afterEach(() => mock.restoreAll());

test("envia JSON para a API configurada e valida a resposta", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => Response.json(reply));
  assert.deepEqual(await sendChatMessage(request), reply);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, "http://localhost:8000/api/chat");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), request);
});

test("explica falha de conexão em português sem reenvio automático", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(sendChatMessage(request), /Não foi possível conectar/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("traduz erros de validação sem depender do formato de detail", async () => {
  mock.method(globalThis, "fetch", async () => Response.json(
    { detail: [{ loc: ["body", "message"], msg: "Invalid input" }] }, { status: 422 },
  ));
  await assert.rejects(sendChatMessage(request), /não atende aos limites/);
});

test("não expõe detalhes internos retornados pelo servidor", async () => {
  mock.method(globalThis, "fetch", async () => Response.json(
    { detail: "Detalhe interno" }, { status: 500 },
  ));
  await assert.rejects(sendChatMessage(request), {
    message: "Não foi possível processar a mensagem. Tente novamente.",
  });
});

test("trata erro HTTP mesmo quando o corpo não é JSON", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Bad Gateway", { status: 502 }));
  await assert.rejects(sendChatMessage(request), /Não foi possível processar/);
});

test("explica indisponibilidade e timeout da IA sem expor detail", async () => {
  for (const [status, message] of [[503, /Verifique a configuração do backend/], [504, /demorou para responder/]]) {
    mock.method(globalThis, "fetch", async () => Response.json({ detail: "segredo" }, { status }));
    await assert.rejects(sendChatMessage(request), message);
    mock.restoreAll();
  }
});

test("rejeita resposta bem-sucedida com JSON malformado", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<html>Erro</html>"));
  await assert.rejects(sendChatMessage(request), /resposta inválida/);
});

test("rejeita outra conversa, papel incorreto e conteúdo ausente", async () => {
  for (const body of [null, {},
    { ...reply, conversation_id: "outra-conversa" },
    { ...reply, message: { role: "user", content: "Olá" } },
    { ...reply, message: { role: "assistant", content: "  " } },
    { ...reply, message: { role: "assistant", content: 42 } },
  ]) {
    mock.method(globalThis, "fetch", async () => Response.json(body));
    await assert.rejects(sendChatMessage(request), /resposta inválida/);
    mock.restoreAll();
  }
});

test("distingue tempo limite de falha de conexão", async () => {
  const timeout = new AbortController();
  timeout.abort();
  mock.method(AbortSignal, "timeout", () => timeout.signal);
  mock.method(globalThis, "fetch", async () => {
    throw new DOMException("Tempo excedido", "TimeoutError");
  });
  await assert.rejects(sendChatMessage(request), /demorou para responder/);
});

test("preserva o cancelamento solicitado pela interface", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancellation = new DOMException("Cancelado", "AbortError");
  mock.method(globalThis, "fetch", async () => { throw cancellation; });
  await assert.rejects(sendChatMessage(request, controller.signal), (error) => error === cancellation);
});

test("contexto excedido é informado sem cortar a pergunta ou o histórico", async () => {
  const longRequest = {
    ...request,
    message: "🎮".repeat(4000),
    history: Array.from({ length: 6 }, () => ({ role: "user", content: "a".repeat(4000) })),
  };
  const original = structuredClone(longRequest);
  const fetchMock = mock.method(globalThis, "fetch", async () => Response.json(
    { detail: "não deve aparecer" },
    { status: 413, headers: { "X-Chat-Error": "context_limit", "X-Chat-Context-Limit": "24000" } },
  ));
  await assert.rejects(sendChatMessage(longRequest), /limite de contexto.*histórico não foi alterado/);
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body), original);
  assert.deepEqual(longRequest, original);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("limites temporário, diário e de capacidade têm mensagens distintas sem reenvio", async () => {
  for (const [status, code, expected] of [
    [429, "rate_limit", /Muitas mensagens.*Aguarde 42 segundos/],
    [429, "daily_limit", /limite diário.*00:00 UTC/],
    [503, "capacity_limit", /chat está ocupado.*Aguarde 42 segundos/],
  ]) {
    const fetchMock = mock.method(globalThis, "fetch", async () => Response.json(
      { detail: "segredo" },
      { status, headers: { "X-Chat-Error": code, "Retry-After": "42" } },
    ));
    await assert.rejects(sendChatMessage(request), expected);
    assert.equal(fetchMock.mock.callCount(), 1);
    mock.restoreAll();
  }
});

test("Retry-After ausente, inválido ou exagerado não é exibido como instrução", async () => {
  for (const retryAfter of [null, "conteúdo não confiável", "-1", "99999", "1.5"]) {
    const headers = { "X-Chat-Error": "capacity_limit" };
    if (retryAfter !== null) headers["Retry-After"] = retryAfter;
    mock.method(globalThis, "fetch", async () => new Response(null, { status: 503, headers }));
    await assert.rejects(sendChatMessage(request), {
      message: "O chat está ocupado com outras solicitações. Aguarde um pouco antes de tentar novamente.",
    });
    mock.restoreAll();
  }
});

test("429 sem código reconhecido continua amigável e não expõe o corpo", async () => {
  mock.method(globalThis, "fetch", async () => new Response("segredo", { status: 429 }));
  await assert.rejects(sendChatMessage(request), {
    message: "Muitas mensagens em pouco tempo. Aguarde um pouco antes de tentar novamente.",
  });
});

test("timeout durante leitura do JSON não é classificado como resposta inválida", async () => {
  const timeout = new AbortController();
  mock.method(AbortSignal, "timeout", () => timeout.signal);
  mock.method(globalThis, "fetch", async () => ({
    ok: true,
    async json() {
      timeout.abort();
      throw new DOMException("Tempo excedido ao ler o corpo", "AbortError");
    },
  }));
  await assert.rejects(sendChatMessage(request), /demorou para responder/);
});

test("cancelamento durante leitura do JSON é preservado", async () => {
  const controller = new AbortController();
  const cancellation = new DOMException("Cancelado ao ler o corpo", "AbortError");
  mock.method(globalThis, "fetch", async () => ({
    ok: true,
    async json() {
      controller.abort();
      throw cancellation;
    },
  }));
  await assert.rejects(sendChatMessage(request, controller.signal), (error) => error === cancellation);
});
