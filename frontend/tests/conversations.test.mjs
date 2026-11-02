import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationsReducer as reduce,
  createConversation,
  initialConversationsState,
} from "../src/lib/conversations.ts";
import {
  CONVERSATION_STORAGE_KEY,
  loadConversationSession,
  saveConversationSession,
} from "../src/lib/conversation-storage.ts";

const A = "550e8400-e29b-41d4-a716-446655440001";
const B = "550e8400-e29b-41d4-a716-446655440002";
const M = "550e8400-e29b-41d4-a716-446655440003";
const R = "550e8400-e29b-41d4-a716-446655440004";
const T1 = "2026-10-18T12:00:00.000Z";
const T2 = "2026-10-18T12:01:00.000Z";
const userMessage = { id: M, role: "user", content: "Quero um RPG" };
const assistant = { id: R, role: "assistant", content: "Resposta de A." };

function initial() {
  return reduce(initialConversationsState, {
    type: "restore",
    session: { version: 1, conversations: [createConversation(A, T1)], activeConversationId: A },
    warning: null,
  });
}

function find(state, id) {
  return state.session.conversations.find((conversation) => conversation.id === id);
}

function beginInA() {
  let state = initial();
  state = reduce(state, { type: "draft", conversationId: A, draft: "  Quero um RPG\n", now: T1 });
  return reduce(state, { type: "begin", pending: { conversationId: A, userMessage }, now: T2 });
}

function storageWith(raw = null) {
  const values = new Map([["outra-aplicacao", "preservar"]]);
  if (raw !== null) values.set(CONVERSATION_STORAGE_KEY, raw);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("nova conversa preserva mensagens e rascunho da anterior", () => {
  let state = initial();
  state = reduce(state, { type: "draft", conversationId: A, draft: "Meu rascunho", now: T2 });
  const previous = state;
  state = reduce(state, { type: "create", conversation: createConversation(B, T2) });

  assert.equal(state.session.activeConversationId, B);
  assert.equal(state.session.conversations.length, 2);
  assert.equal(find(state, A).draft, "Meu rascunho");
  assert.equal(find(state, B).draft, "");
  assert.equal(previous.session.conversations.length, 1);
  state = reduce(state, { type: "select", conversationId: A });
  assert.equal(state.session.activeConversationId, A);
  assert.equal(find(state, A).draft, "Meu rascunho");
});

test("resposta de A chega em A mesmo com B selecionada e com outro rascunho", () => {
  let state = beginInA();
  state = reduce(state, { type: "create", conversation: createConversation(B, T2) });
  state = reduce(state, { type: "draft", conversationId: B, draft: "Quero um jogo de corrida", now: T2 });
  const previous = state;
  state = reduce(state, { type: "success", conversationId: A, requestId: M, assistant, now: T2 });

  assert.equal(state.session.activeConversationId, B);
  assert.deepEqual(find(state, A).messages, [userMessage, assistant]);
  assert.equal(find(state, A).draft, "");
  assert.deepEqual(find(state, B).messages, []);
  assert.equal(find(state, B).draft, "Quero um jogo de corrida");
  assert.deepEqual(state.pendingByConversation, {});
  assert.deepEqual(find(previous, A).messages, []);
});

test("falha em A preserva o rascunho original e não mostra erro em B", () => {
  let state = beginInA();
  state = reduce(state, { type: "create", conversation: createConversation(B, T2) });
  state = reduce(state, { type: "draft", conversationId: B, draft: "Texto de B", now: T2 });
  state = reduce(state, { type: "failure", conversationId: A, requestId: M, error: "Falha na conexão" });

  assert.equal(state.session.activeConversationId, B);
  assert.equal(find(state, A).draft, "  Quero um RPG\n");
  assert.equal(find(state, B).draft, "Texto de B");
  assert.equal(state.errors[A], "Falha na conexão");
  assert.equal(state.errors[B], undefined);
  assert.deepEqual(find(state, A).messages, []);
  assert.deepEqual(state.pendingByConversation, {});
});

test("permite apenas um envio por conversa e ignora respostas de requisições diferentes", () => {
  const state = beginInA();
  assert.equal(reduce(state, { type: "begin", pending: { conversationId: A, userMessage }, now: T2 }), state);
  assert.equal(reduce(state, { type: "success", conversationId: B, requestId: M, assistant, now: T2 }), state);
  assert.equal(reduce(state, { type: "success", conversationId: A, requestId: R, assistant, now: T2 }), state);
  assert.equal(reduce(state, { type: "draft", conversationId: A, draft: "Alterado durante envio", now: T2 }), state);
  const completed = reduce(state, { type: "success", conversationId: A, requestId: M, assistant, now: T2 });
  assert.equal(reduce(completed, { type: "success", conversationId: A, requestId: M, assistant, now: T2 }), completed);
});

function beginInBoth() {
  let state = beginInA();
  state = reduce(state, { type: "create", conversation: createConversation(B, T2) });
  state = reduce(state, { type: "draft", conversationId: B, draft: "Pergunta de B", now: T2 });
  return reduce(state, {
    type: "begin", pending: { conversationId: B, userMessage: { ...userMessage, id: B, content: "Pergunta de B" } }, now: T2,
  });
}

test("envios simultâneos concluem fora de ordem sem misturar históricos ou liberar outra conversa", () => {
  for (const first of [A, B]) {
    const second = first === A ? B : A;
    const state = beginInBoth();
    assert.deepEqual(Object.keys(state.pendingByConversation).sort(), [A, B]);
    const pending = state.pendingByConversation[first];
    const firstReply = { ...assistant, content: `Resposta de ${first}` };
    const completed = reduce(state, { type: "success", conversationId: first, requestId: pending.userMessage.id, assistant: firstReply, now: T2 });

    assert.deepEqual(find(completed, first).messages, [pending.userMessage, firstReply]);
    assert.deepEqual(find(completed, second).messages, []);
    assert.equal(find(completed, first).draft, "");
    assert.equal(find(completed, second).draft, find(state, second).draft);
    assert.deepEqual(Object.keys(completed.pendingByConversation), [second]);
    assert.equal(completed.session.activeConversationId, B);
    assert.equal(reduce(completed, { type: "begin", pending: state.pendingByConversation[second], now: T2 }), completed);
    assert.equal(reduce(completed, { type: "success", conversationId: first, requestId: pending.userMessage.id, assistant, now: T2 }), completed);

    const final = reduce(completed, { type: "success", conversationId: second, requestId: state.pendingByConversation[second].userMessage.id, assistant, now: T2 });
    assert.deepEqual(final.pendingByConversation, {});
    assert.equal(find(final, A).messages.length, 2);
    assert.equal(find(final, B).messages.length, 2);
    assert.deepEqual(Object.keys(state.pendingByConversation).sort(), [A, B]);
  }
});

test("falha e nova tentativa em A não interrompem B nem aceitam a resposta antiga de A", () => {
  let state = beginInBoth();
  const pendingB = state.pendingByConversation[B];
  state = reduce(state, { type: "failure", conversationId: A, requestId: M, error: "Falha em A" });
  assert.equal(state.pendingByConversation[B], pendingB);
  assert.equal(find(state, A).draft, "  Quero um RPG\n");
  assert.equal(state.errors[B], "");

  state = reduce(state, { type: "begin", pending: { conversationId: A, userMessage: { ...userMessage, id: R } }, now: T2 });
  assert.equal(state.errors[A], "");
  assert.equal(reduce(state, { type: "success", conversationId: A, requestId: M, assistant, now: T2 }), state);
  assert.equal(reduce(state, { type: "failure", conversationId: A, requestId: M, error: "Erro antigo" }), state);
  state = reduce(state, { type: "success", conversationId: B, requestId: B, assistant, now: T2 });
  assert.deepEqual(Object.keys(state.pendingByConversation), [A]);
  state = reduce(state, { type: "success", conversationId: A, requestId: R, assistant, now: T2 });
  assert.deepEqual(state.pendingByConversation, {});
});

test("recarga com dois envios recupera ambos os rascunhos sem restaurar requisições", () => {
  const state = beginInBoth();
  const storage = storageWith();
  saveConversationSession(state.session, () => storage);
  const loaded = loadConversationSession(() => storage);
  const restored = reduce(initialConversationsState, { type: "restore", session: loaded.session, warning: loaded.warning });
  for (const id of [A, B]) {
    assert.equal(find(restored, id).draft, find(state, id).draft);
    assert.deepEqual(find(restored, id).messages, []);
  }
  assert.deepEqual(restored.pendingByConversation, {});
  assert.equal(storage.values.get(CONVERSATION_STORAGE_KEY).includes("pendingByConversation"), false);
});

test("não seleciona IDs inexistentes nem duplica conversa na inicialização", () => {
  const state = initial();
  assert.equal(reduce(state, { type: "select", conversationId: B }), state);
  assert.equal(reduce(state, { type: "create", conversation: createConversation(A, T2) }), state);
  assert.equal(reduce(state, { type: "restore", session: state.session, warning: null }), state);
});

test("título usa a primeira mensagem e limita emojis sem quebrar caracteres", () => {
  const content = `  ${"🎮".repeat(65)}\nmais texto  `;
  const state = reduce(initial(), {
    type: "begin", pending: { conversationId: A, userMessage: { ...userMessage, content } }, now: T2,
  });
  assert.equal(Array.from(find(state, A).title).length, 60);
  assert.ok(find(state, A).title.endsWith("…"));
  assert.ok(!find(state, A).title.includes("\n"));
});

test("restaura conversas, ordem, rascunhos e seleção sem acessar outras chaves", () => {
  let state = beginInA();
  state = reduce(state, { type: "success", conversationId: A, requestId: M, assistant, now: T2 });
  state = reduce(state, { type: "create", conversation: createConversation(B, T2) });
  state = reduce(state, { type: "draft", conversationId: B, draft: "Meu próximo assunto", now: T2 });
  const storage = storageWith();
  assert.equal(saveConversationSession(state.session, () => storage), null);
  const restored = loadConversationSession(() => storage);
  assert.deepEqual(restored.session, state.session);
  assert.equal(restored.warning, null);
  assert.equal(restored.canPersist, true);
  assert.equal(storage.values.get("outra-aplicacao"), "preservar");
});

test("recarga durante envio recupera rascunho e não restaura envio ou mensagem pendente", () => {
  const state = beginInA();
  const storage = storageWith();
  saveConversationSession(state.session, () => storage);
  const loaded = loadConversationSession(() => storage);
  const restored = reduce(initialConversationsState, { type: "restore", session: loaded.session, warning: loaded.warning });

  assert.equal(find(restored, A).draft, "  Quero um RPG\n");
  assert.deepEqual(find(restored, A).messages, []);
  assert.deepEqual(restored.pendingByConversation, {});
  assert.deepEqual(restored.errors, {});
  assert.equal(storage.values.get(CONVERSATION_STORAGE_KEY).includes('"pending"'), false);
});

test("ausência de dados permite criar e salvar uma nova sessão", () => {
  assert.deepEqual(loadConversationSession(() => storageWith()), {
    session: null, warning: null, canPersist: true,
  });
});

test("bloqueio do navegador ou falha de leitura retorna aviso e permite modo em memória", () => {
  for (const getStorage of [
    () => { throw new Error("SecurityError"); },
    () => ({ getItem() { throw new Error("SecurityError"); } }),
  ]) {
    const result = loadConversationSession(getStorage);
    assert.equal(result.session, null);
    assert.equal(result.canPersist, false);
    assert.match(result.warning, /indisponível/);
  }
});

test("dados inválidos ou de outra versão são preservados sem sobrescrita", () => {
  const session = initial().session;
  for (const raw of [
    "{json inválido", "null", "[]",
    JSON.stringify({ ...session, version: 2 }),
    JSON.stringify({ ...session, activeConversationId: B }),
    JSON.stringify({ ...session, conversations: [] }),
    JSON.stringify({ ...session, conversations: [session.conversations[0], session.conversations[0]] }),
    JSON.stringify({ ...session, conversations: [{ ...session.conversations[0], id: "id inválido" }] }),
    JSON.stringify({ ...session, conversations: [{ ...session.conversations[0], updatedAt: "inválida" }] }),
    JSON.stringify({ ...session, conversations: [{ ...session.conversations[0], draft: 123 }] }),
    JSON.stringify({ ...session, conversations: [{ ...session.conversations[0], messages: [{ ...userMessage, role: "system" }] }] }),
    JSON.stringify({ ...session, conversations: [{ ...session.conversations[0], messages: [userMessage, userMessage] }] }),
  ]) {
    const storage = storageWith(raw);
    const result = loadConversationSession(() => storage);
    assert.equal(result.session, null);
    assert.equal(result.canPersist, false);
    assert.match(result.warning, /preservados/);
    assert.equal(storage.values.get(CONVERSATION_STORAGE_KEY), raw);
  }
});

test("ignora campos desconhecidos no JSON recuperado", () => {
  const session = initial().session;
  const raw = JSON.stringify({
    ...session, pending: { conversationId: A }, errors: { [A]: "Falha antiga" },
    conversations: [{ ...session.conversations[0], extra: true, messages: [{ ...userMessage, extra: true }] }],
  });
  const result = loadConversationSession(() => storageWith(raw));
  assert.equal(result.canPersist, true);
  assert.equal(result.session.pending, undefined);
  assert.equal(result.session.errors, undefined);
  assert.equal(result.session.conversations[0].extra, undefined);
  assert.deepEqual(result.session.conversations[0].messages, [userMessage]);
});

test("limite de espaço gera aviso sem apagar o que já estava salvo", () => {
  const session = initial().session;
  const storage = storageWith(JSON.stringify(session));
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.match(saveConversationSession(session, () => storage), /Não foi possível salvar/);
  assert.equal(storage.values.get(CONVERSATION_STORAGE_KEY), JSON.stringify(session));
});
