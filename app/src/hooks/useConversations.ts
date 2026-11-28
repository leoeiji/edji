import { useCallback, useEffect, useState } from 'react';
import { CHAT_TOPIC, closeInterruptedMessages, listConversations, type Conversation } from '@/core/chatStore';
import { getDb } from '@/core/db';
import { onChanged } from '@/core/events';
import { ensureReady } from '@/core/runtime';

let closedInterrupted = false;

/**
 * The saved conversations, most recent first, kept fresh as turns and titles
 * land. On first use it closes replies a dead app left streaming.
 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const reload = useCallback(async () => {
    await ensureReady();
    const db = await getDb();
    if (!closedInterrupted) {
      closedInterrupted = true;
      await closeInterruptedMessages(db);
    }
    setConversations(await listConversations(db));
  }, []);

  useEffect(() => {
    reload();
    return onChanged(CHAT_TOPIC, () => {
      reload();
    });
  }, [reload]);

  return conversations;
}
