import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_INSTRUCTIONS } from '@/agent/agent';
import { fallbackTitle } from '@/agent/light';
import { openRouterModel } from '@/agent/openrouter';
import { loadModelSettings } from '@/agent/settings';
import { CHAT_TOPIC, createConversation, getConversation, loadMessages, type StoredMessage } from '@/core/chatStore';
import { runPersistedTurn, titleConversation } from '@/core/chatTurn';
import type { LiveTurn } from '@/core/chatView';
import { getDb } from '@/core/db';
import { onChanged } from '@/core/events';
import { agentTools, ensureReady } from '@/core/runtime';
import { USAGE_TOPIC, conversationSteps, type UsageStep } from '@/core/usage';

/**
 * One conversation of the text chat. `conversationId` null is a new chat:
 * the first message creates it and reports its id through [onCreated]. A
 * reply keeps streaming into the database if the user switches chats; the
 * screen only shows it live for its own conversation.
 */
export function useChat(conversationId: number | null, onCreated: (id: number) => void) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [steps, setSteps] = useState<UsageStep[]>([]);
  const [live, setLive] = useState<(LiveTurn & { conversationId: number }) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const shown = useRef(conversationId);
  shown.current = conversationId;
  const lastShownId = useRef(0);
  lastShownId.current = messages.at(-1)?.id ?? 0;

  const reload = useCallback(async () => {
    const id = shown.current;
    if (id === null) return setMessages([]);
    await ensureReady();
    const loaded = await loadMessages(await getDb(), id);
    if (shown.current === id) setMessages(loaded);
  }, []);

  const reloadSteps = useCallback(async () => {
    const id = shown.current;
    if (id === null) return setSteps([]);
    await ensureReady();
    const loaded = await conversationSteps(await getDb(), id);
    if (shown.current === id) setSteps(loaded);
  }, []);

  useEffect(() => {
    setMessages([]);
    setSteps([]);
    reload();
    reloadSteps();
    // A voice turn of this conversation may land while it is open; usage lands step by step.
    const offChat = onChanged(CHAT_TOPIC, () => {
      reload();
    });
    const offUsage = onChanged(USAGE_TOPIC, () => {
      reloadSteps();
    });
    return () => {
      offChat();
      offUsage();
    };
  }, [conversationId, reload, reloadSteps]);

  const send = useCallback(
    async (text: string) => {
      const userText = text.trim();
      if (!userText || controller.current) return;
      await ensureReady();
      const db = await getDb();
      const conversation =
        (conversationId !== null ? await getConversation(db, conversationId) : null) ??
        (await createConversation(db, { title: fallbackTitle(userText), origin: 'app' }));
      if (conversation.id !== conversationId) onCreated(conversation.id);

      const abort = new AbortController();
      controller.current = abort;
      // Stored rows of this turn reload while it streams; until its id is known, hide anything newer than what is shown.
      let fromMessageId = conversation.id === conversationId ? lastShownId.current + 1 : 0;
      setLive({ conversationId: conversation.id, userText, parts: [], fromMessageId });
      try {
        const settings = await loadModelSettings();
        const result = await runPersistedTurn({
          db,
          conversationId: conversation.id,
          userText,
          settings,
          createModel: openRouterModel,
          instructions: CHAT_INSTRUCTIONS,
          tools: await agentTools(),
          signal: abort.signal,
          onStored: (id) => {
            fromMessageId = id;
            setLive((l) => (l ? { ...l, fromMessageId: id } : l));
          },
          onParts: (parts) => setLive({ conversationId: conversation.id, userText, parts, fromMessageId }),
        });
        controller.current = null;
        if (shown.current === conversation.id) setMessages(await loadMessages(db, conversation.id));
        setLive(null);
        await titleConversation(db, conversation, userText, result, { settings, createModel: openRouterModel });
      } finally {
        controller.current = null;
        setLive(null);
      }
    },
    [conversationId, onCreated],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  return {
    messages,
    steps,
    live: live && live.conversationId === conversationId ? live : null,
    busy: live !== null,
    send,
    stop,
  };
}
