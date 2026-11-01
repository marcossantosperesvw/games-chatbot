"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { sendChatMessage } from "@/lib/api";
import { createChatRequest, getHistoryError } from "@/lib/chat";
import { loadConversationSession, saveConversationSession } from "@/lib/conversation-storage";
import { conversationsReducer, createConversation, initialConversationsState } from "@/lib/conversations";
import type { ChatMessage, ChatRequest } from "@/types/chat";

export function useChat() {
  const [includeVideos, setIncludeVideos] = useState(false);
  const [state, dispatch] = useReducer(conversationsReducer, initialConversationsState);
  const canPersist = useRef(false);
  const activeRequests = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const restored = loadConversationSession();
    canPersist.current = restored.canPersist;
    let session = restored.session;
    if (!session) {
      const conversation = createConversation(crypto.randomUUID(), new Date().toISOString());
      session = { version: 1, conversations: [conversation], activeConversationId: conversation.id };
    }
    dispatch({ type: "restore", session, warning: restored.warning });
    const requests = activeRequests.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, []);

  useEffect(() => {
    if (!state.session || !canPersist.current) return;
    const session = state.session;
    function persist() {
      const warning = saveConversationSession(session);
      dispatch({ type: "storage-warning", warning });
    }
    persist();
    const interval = window.setInterval(persist, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [state.session]);

  const conversation = state.session?.conversations.find(
    ({ id }) => id === state.session?.activeConversationId,
  );
  const pending = conversation ? state.pendingByConversation[conversation.id] : undefined;
  const isSending = Boolean(pending);
  const messages = conversation
    ? pending
      ? [...conversation.messages, pending.userMessage]
      : conversation.messages
    : [];

  function setDraft(draft: string) {
    if (!conversation) return;
    dispatch({ type: "draft", conversationId: conversation.id, draft, now: new Date().toISOString() });
  }

  function startNewConversation() {
    if (!state.session) return;
    dispatch({ type: "create", conversation: createConversation(crypto.randomUUID(), new Date().toISOString()) });
  }

  function selectConversation(conversationId: string) {
    dispatch({ type: "select", conversationId });
  }

  async function sendMessage() {
    if (!conversation || activeRequests.current.has(conversation.id)) return;
    const conversationId = conversation.id;
    let request: ChatRequest;

    try {
      request = createChatRequest(conversationId, conversation.draft, conversation.messages);
      if (includeVideos) request.include_videos = true;
    } catch (cause) {
      dispatch({
        type: "error",
        conversationId,
        error: cause instanceof Error ? cause.message : "Não foi possível enviar.",
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: request.message,
    };
    const controller = new AbortController();
    activeRequests.current.set(conversationId, controller);
    dispatch({
      type: "begin",
      pending: { conversationId, userMessage },
      now: new Date().toISOString(),
    });

    try {
      const response = await sendChatMessage(request, controller.signal);
      if (controller.signal.aborted) return;
      dispatch({
        type: "success",
        conversationId,
        requestId: userMessage.id,
        assistant: { id: crypto.randomUUID(), ...response.message },
        now: new Date().toISOString(),
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      dispatch({
        type: "failure",
        conversationId,
        requestId: userMessage.id,
        error: cause instanceof Error ? cause.message : "Não foi possível enviar. Tente novamente.",
      });
    } finally {
      if (activeRequests.current.get(conversationId) === controller) {
        activeRequests.current.delete(conversationId);
      }
    }
  }

  return {
    conversations: state.session?.conversations ?? [],
    includeVideos,
    setIncludeVideos,
    activeConversation: conversation,
    pendingConversationIds: Object.keys(state.pendingByConversation),
    isReady: state.session !== null,
    storageWarning: state.storageWarning,
    messages,
    draft: isSending ? "" : conversation?.draft ?? "",
    setDraft,
    isSending,
    error: conversation ? state.errors[conversation.id] || null : null,
    historyError: conversation ? getHistoryError(conversation.messages) : null,
    sendMessage,
    startNewConversation,
    selectConversation,
  };
}
