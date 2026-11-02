import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, StrictMode } from "react";
import { JSDOM } from "jsdom";
import { loadChat } from "./helpers/load-chat.mjs";

async function mountChat(t, prepare = () => {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://192.168.1.10:3000" });
  Object.defineProperty(dom.window.crypto, "randomUUID", { value: undefined });
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const originals = new Map();
  let root;
  t.after(async () => {
    try {
      if (root) await act(async () => root.unmount());
    } finally {
      dom.window.close();
      for (const [key, original] of originals) {
        if (original) Object.defineProperty(globalThis, key, original);
        else delete globalThis[key];
      }
    }
  });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, crypto: dom.window.crypto,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  prepare(dom.window);
  const { createRoot } = await import("react-dom/client");
  const { Chat } = await loadChat();
  root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Chat))));
  return dom.window.document;
}

test("sessão nova sem randomUUID sai da recuperação e mostra sugestões", async (t) => {
  const document = await mountChat(t);
  assert.doesNotMatch(document.body.textContent, /Recuperando conversas/);
  assert.match(document.body.textContent, /O que vamos jogar ou aprender hoje/);
  assert.match(document.body.textContent, /Quero um jogo cooperativo/);
  assert.equal(document.querySelector("textarea").disabled, false);
});

test("dados inválidos são preservados sem impedir sugestões e nova conversa", async (t) => {
  const document = await mountChat(t, (window) => {
    window.sessionStorage.setItem("chat-jogos:session:v1", "dados inválidos");
  });
  assert.match(document.body.textContent, /O que vamos jogar ou aprender hoje/);
  assert.match(document.body.textContent, /Não foi possível recuperar os dados salvos/);
  await act(async () => {
    [...document.querySelectorAll("button")].find((button) =>
      button.textContent.trim() === "+ Nova conversa").click();
  });
  assert.equal(window.sessionStorage.getItem("chat-jogos:session:v1"), "dados inválidos");
  assert.equal(document.querySelectorAll('nav[aria-label="Selecionar conversa"] button').length, 2);
});

test("armazenamento bloqueado permite iniciar o chat apenas em memória", async (t) => {
  const document = await mountChat(t, (window) => {
    Object.defineProperty(window, "sessionStorage", {
      get() { throw new window.DOMException("Bloqueado", "SecurityError"); },
    });
  });
  assert.doesNotMatch(document.body.textContent, /Recuperando conversas/);
  assert.match(document.body.textContent, /O armazenamento da sessão está indisponível/);
  assert.match(document.body.textContent, /Quero um jogo cooperativo/);
  assert.equal(document.querySelector("textarea").disabled, false);
});

test("duas conversas enviam em paralelo sem randomUUID e recebem respostas fora de ordem", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", (_url, options) => new Promise((resolve) => {
    requests.push({ request: JSON.parse(options.body), resolve });
  }));
  const document = await mountChat(t);
  const click = async (text) => act(async () => {
    [...document.querySelectorAll("button")].find((button) =>
      button.textContent.trim() === text).click();
  });
  const submit = async () => act(async () => {
    document.querySelector("form").dispatchEvent(new window.Event("submit", {
      bubbles: true, cancelable: true,
    }));
  });
  const reply = async (index, content) => act(async () => {
    requests[index].resolve(Response.json({
      conversation_id: requests[index].request.conversation_id,
      message: { role: "assistant", content },
    }));
  });
  await click("Quero um jogo cooperativo");
  await submit();
  assert.equal(requests.length, 1);
  // A second send in the same conversation stays blocked.
  await submit();
  assert.equal(requests.length, 1);
  await click("+ Nova conversa");
  assert.equal(document.querySelector("textarea").disabled, false);
  await click("Como funciona o Steam Cloud?");
  await submit();
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].request.conversation_id, requests[1].request.conversation_id);
  assert.deepEqual(requests.map(({ request }) => request.history), [[], []]);
  assert.equal((document.body.textContent.match(/Aguardando resposta/g) ?? []).length, 2);

  await reply(1, "Resposta da conversa B");
  assert.match(document.body.textContent, /Resposta da conversa B/);
  await act(async () => document.querySelector(
    '[aria-label="Abrir conversa: Quero um jogo cooperativo"]',
  ).click());
  assert.doesNotMatch(document.querySelector('[role="log"]').textContent, /Resposta da conversa B/);
  assert.equal(document.querySelector("textarea").disabled, true);
  await reply(0, "Resposta da conversa A");
  assert.match(document.querySelector('[role="log"]').textContent, /Resposta da conversa A/);
  assert.equal(document.querySelector("textarea").disabled, false);

  const session = JSON.parse(window.sessionStorage.getItem("chat-jogos:session:v1"));
  for (const [index, content] of ["Resposta da conversa A", "Resposta da conversa B"].entries()) {
    const conversation = session.conversations.find(({ id }) => id === requests[index].request.conversation_id);
    assert.deepEqual(conversation.messages.map(({ content }) => content), [requests[index].request.message, content]);
    assert.equal(conversation.draft, "");
  }
});
