import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Composer } from '@/components/chat/Composer';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { SessionUsage } from '@/components/chat/SessionUsage';
import { ToolCard } from '@/components/chat/ToolCard';
import { UpdateBanner } from '@/components/chat/UpdateBanner';
import { UsageLine } from '@/components/chat/UsageLine';
import { UsageSheet } from '@/components/chat/UsageSheet';
import { chatRows, type ChatRow } from '@/core/chatView';
import { byMessage, summarize } from '@/core/usage';
import type { AppUpdate } from '@/hooks/useAppUpdate';
import { useAttachments } from '@/hooks/useAttachments';
import { useChat } from '@/hooks/useChat';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useTheme } from '@/theme';

type Props = {
  conversationId: number | null;
  onCreated(id: number): void;
  onOpenSettings(): void;
  update: AppUpdate;
};

/**
 * The home screen: a text chat with the agent, tool calls shown as cards, and
 * a banner when an update is out. Each finished reply shows its tokens; the
 * conversation's total sits on top (ADR 0008).
 */
export function ChatScreen({ conversationId, onCreated, onOpenSettings, update }: Props) {
  const t = useTheme();
  const { messages, steps, live, busy, send, stop } = useChat(conversationId, onCreated);
  const attachments = useAttachments();
  const keyboard = useKeyboardInset();
  const [detail, setDetail] = useState<number | null>(null);
  const stepsByMessage = useMemo(() => byMessage(steps), [steps]);
  const usage = useMemo(() => new Map([...stepsByMessage].map(([id, list]) => [id, summarize(list)])), [stepsByMessage]);
  const session = useMemo(() => (steps.length ? summarize(steps) : null), [steps]);
  // Inverted list: newest at the bottom, and it stays there as the reply grows.
  const rows = useMemo(() => chatRows(messages, live, usage).reverse(), [messages, live, usage]);
  const toolNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const m of messages) for (const p of m.parts) if (p.type === 'tool') names[p.id] = p.name;
    return names;
  }, [messages]);

  const render = ({ item }: { item: ChatRow }) => {
    switch (item.kind) {
      case 'user':
        return <MessageBubble kind="user" text={item.text} attachments={item.attachments} />;
      case 'text':
        return <MessageBubble kind="text" text={item.text} />;
      case 'tool':
        return <ToolCard tool={item.tool} />;
      case 'error':
        return <MessageBubble kind="error" text={item.text} onSettings={item.setup ? onOpenSettings : undefined} />;
      case 'thinking':
        return <MessageBubble kind="thinking" />;
      case 'stopped':
        return <MessageBubble kind="stopped" />;
      case 'usage':
        return <UsageLine usage={item.usage} onPress={() => setDetail(item.messageId)} />;
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: keyboard }]}>
      <UpdateBanner update={update} />
      {session && session.totalTokens > 0 && <SessionUsage usage={session} />}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: t.text }]}>O que você precisa?</Text>
          <Text style={[styles.emptyText, { color: t.muted }]}>Pergunte, registre um gasto ou peça uma rotina.</Text>
        </View>
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={render}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <Composer busy={busy} attachments={attachments} onSend={send} onStop={stop} onOpenSettings={onOpenSettings} />
      {detail !== null && stepsByMessage.get(detail) && (
        <UsageSheet steps={stepsByMessage.get(detail)!} toolNames={toolNames} onClose={() => setDetail(null)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 6 },
  emptyTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  emptyText: { fontSize: 16, lineHeight: 22 },
});
