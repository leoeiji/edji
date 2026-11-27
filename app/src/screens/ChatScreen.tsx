import { useMemo } from 'react';
import { FlatList, KeyboardAvoidingView, StyleSheet, Text, View } from 'react-native';
import { Composer } from '@/components/chat/Composer';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ToolCard } from '@/components/chat/ToolCard';
import { chatRows, type ChatRow } from '@/core/chatView';
import { useChat } from '@/hooks/useChat';
import { useTheme } from '@/theme';

type Props = {
  conversationId: number | null;
  onCreated(id: number): void;
  onOpenSettings(): void;
};

/** The home screen: a text chat with the agent, tool calls shown as cards. */
export function ChatScreen({ conversationId, onCreated, onOpenSettings }: Props) {
  const t = useTheme();
  const { messages, live, busy, send, stop } = useChat(conversationId, onCreated);
  // Inverted list: newest at the bottom, and it stays there as the reply grows.
  const rows = useMemo(() => chatRows(messages, live).reverse(), [messages, live]);

  const render = ({ item }: { item: ChatRow }) => {
    switch (item.kind) {
      case 'user':
        return <MessageBubble kind="user" text={item.text} />;
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
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
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
      <Composer busy={busy} onSend={send} onStop={stop} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  empty: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 6 },
  emptyTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  emptyText: { fontSize: 16, lineHeight: 22 },
});
