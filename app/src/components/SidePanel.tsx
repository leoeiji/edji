import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Conversation } from '@/core/chatStore';
import { groupConversations } from '@/core/chatView';
import type { Destination } from '@/navigation/destinations';
import { useTheme } from '@/theme';

type Props = {
  conversations: Conversation[];
  /** The open conversation, when the chat is the current screen. */
  activeConversationId: number | null;
  /** Plugin views and fixed screens, below the conversations. */
  destinations: Destination[];
  activeKey: string | null;
  /** Index before which a divider separates the plugin views from the fixed screens. */
  dividerAt: number;
  onNewConversation(): void;
  onOpenConversation(id: number): void;
  onRename(id: number, title: string): void;
  onDelete(id: number): void;
  onSelect(key: string): void;
  onClose(): void;
};

type Menu = { id: number; mode: 'menu' | 'rename' | 'delete' };

/**
 * Side panel over the current screen, closed by tapping the scrim: new
 * conversation, the saved ones by day (long press to rename or delete), then
 * the plugin views and the fixed screens.
 */
export function SidePanel(props: Props) {
  const t = useTheme();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [draft, setDraft] = useState('');
  const groups = groupConversations(props.conversations, Date.now());

  const item = (c: Conversation) => {
    const active = c.id === props.activeConversationId;
    const pending = c.titleStatus === 'pending';
    return (
      <View key={c.id}>
        <Pressable
          onPress={() => props.onOpenConversation(c.id)}
          onLongPress={() => setMenu({ id: c.id, mode: 'menu' })}
          accessibilityHint="Toque e segure para renomear ou apagar"
          style={[styles.conv, active && { backgroundColor: t.surface }]}
        >
          <Text style={[styles.convText, { color: active ? t.accent : t.text, fontStyle: pending ? 'italic' : 'normal' }]} numberOfLines={1}>
            {c.title}
          </Text>
          {c.origin === 'voice' && (
            <Text style={[styles.badge, { backgroundColor: t.surface, color: t.muted }]} accessibilityLabel="Conversa por voz">
              voz
            </Text>
          )}
        </Pressable>
        {menu?.id === c.id && renderMenu(c)}
      </View>
    );
  };

  const renderMenu = (c: Conversation) => {
    const box = [styles.menu, { backgroundColor: t.bg, borderColor: t.line }];
    if (menu?.mode === 'rename') {
      const save = () => {
        props.onRename(c.id, draft);
        setMenu(null);
      };
      return (
        <View style={box}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            onSubmitEditing={save}
            accessibilityLabel="Novo nome da conversa"
            style={[styles.input, { color: t.text, borderColor: t.line }]}
          />
          <View style={styles.menuRow}>
            <MenuButton label="Cancelar" onPress={() => setMenu(null)} />
            <MenuButton label="Salvar" strong onPress={save} />
          </View>
        </View>
      );
    }
    if (menu?.mode === 'delete') {
      return (
        <View style={box}>
          <Text style={[styles.confirm, { color: t.text }]}>Apagar esta conversa? Não dá para desfazer.</Text>
          <View style={styles.menuRow}>
            <MenuButton label="Cancelar" onPress={() => setMenu(null)} />
            <MenuButton
              label="Apagar"
              danger
              onPress={() => {
                props.onDelete(c.id);
                setMenu(null);
              }}
            />
          </View>
        </View>
      );
    }
    return (
      <View style={box}>
        <MenuButton
          label="Renomear"
          onPress={() => {
            setDraft(c.title);
            setMenu({ id: c.id, mode: 'rename' });
          }}
        />
        <MenuButton label="Apagar" danger onPress={() => setMenu({ id: c.id, mode: 'delete' })} />
      </View>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]} onPress={props.onClose} accessibilityLabel="Fechar menu" />
      <View style={[styles.panel, { backgroundColor: t.bg }]}>
        <Text style={[styles.brand, { color: t.text }]}>Edji.</Text>
        <Pressable onPress={props.onNewConversation} accessibilityRole="button" style={[styles.newChat, { backgroundColor: t.heroBg }]}>
          <Text style={[styles.newPlus, { color: t.heroHi }]}>+</Text>
          <Text style={[styles.newText, { color: t.heroText }]}>Nova conversa</Text>
        </Pressable>
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          {groups.map((g) => (
            <View key={g.title}>
              <Text style={[styles.day, { color: t.muted }]}>{g.title}</Text>
              {g.items.map(item)}
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: t.line }]} />
          {props.destinations.map((d, i) => (
            <View key={d.key}>
              {i === props.dividerAt && i > 0 && <View style={[styles.divider, { backgroundColor: t.line }]} />}
              <Pressable onPress={() => props.onSelect(d.key)} style={[styles.item, d.key === props.activeKey && { backgroundColor: t.surface }]}>
                <Text style={[styles.itemText, { color: d.key === props.activeKey ? t.accent : t.text }]}>{d.title}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function MenuButton({ label, onPress, danger, strong }: { label: string; onPress(): void; danger?: boolean; strong?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6} style={styles.menuButton}>
      <Text style={{ color: danger ? t.danger : strong ? t.accent : t.text, fontWeight: danger || strong ? '700' : '500', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '82%', maxWidth: 340, paddingTop: 56, paddingHorizontal: 12 },
  brand: { fontSize: 32, fontWeight: '900', paddingHorizontal: 12, marginBottom: 16 },
  newChat: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  newPlus: { fontSize: 22, fontWeight: '900', lineHeight: 24 },
  newText: { fontSize: 16, fontWeight: '700' },
  scroll: { flex: 1 },
  day: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 },
  conv: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  convText: { flex: 1, fontSize: 15 },
  badge: { fontSize: 11, fontWeight: '700', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  menu: { marginHorizontal: 12, marginBottom: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 8, gap: 6 },
  menuRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  menuButton: { paddingHorizontal: 8, paddingVertical: 6 },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  confirm: { fontSize: 14, lineHeight: 20, paddingHorizontal: 4 },
  item: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  itemText: { fontSize: 17, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10, marginHorizontal: 12 },
});
