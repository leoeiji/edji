import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { onChanged } from '../../core/events';
import type { PluginContext } from '../../core/plugin';
import { useTheme } from '../../ui/theme';
import { addItem, listItems, removeItem, setDone, type TodoItem } from './store';
import { cleanTaskText } from './text';

export function TodoView({ ctx }: { ctx: PluginContext }) {
  const t = useTheme();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [draft, setDraft] = useState('');

  const reload = useCallback(() => {
    listItems(ctx.db).then(setItems);
  }, [ctx.db]);

  useEffect(() => {
    reload();
    return onChanged('todo', reload);
  }, [reload]);

  const submit = async () => {
    const text = cleanTaskText(draft);
    if (!text) return;
    await addItem(ctx.db, text, 'app');
    setDraft('');
    ctx.notifyChanged();
  };

  const openCount = items.filter((i) => !i.done).length;

  return (
    <View style={styles.root}>
      <Text style={[styles.count, { color: t.muted }]}>
        {openCount === 0 ? 'Nada pendente.' : `${openCount} ${openCount === 1 ? 'pendente' : 'pendentes'}`}
      </Text>

      <View style={[styles.inputRow, { backgroundColor: t.surface }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder="Nova tarefa"
          placeholderTextColor={t.muted}
          returnKeyType="done"
          style={[styles.input, { color: t.text }]}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.muted }]}>
            Segure o botão lateral e diga o que precisa fazer.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: t.line }]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.done }}
              onPress={async () => {
                await setDone(ctx.db, item.id, !item.done);
                ctx.notifyChanged();
              }}
              style={[styles.check, { borderColor: t.accent, backgroundColor: item.done ? t.accent : 'transparent' }]}
            >
              {item.done && <Text style={{ color: t.onAccent, fontWeight: '900' }}>✓</Text>}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.text, { color: item.done ? t.muted : t.text }, item.done && styles.doneText]}>
                {item.text}
              </Text>
              {item.source === 'voz' && <Text style={[styles.source, { color: t.muted }]}>por voz</Text>}
            </View>
            <Pressable
              accessibilityLabel={`Excluir ${item.text}`}
              hitSlop={10}
              onPress={async () => {
                await removeItem(ctx.db, item.id);
                ctx.notifyChanged();
              }}
            >
              <Text style={{ color: t.muted, fontSize: 18 }}>×</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  count: { fontSize: 14, marginBottom: 12 },
  inputRow: { borderRadius: 14, paddingHorizontal: 14, marginBottom: 8 },
  input: { fontSize: 16, paddingVertical: 12 },
  empty: { fontSize: 16, lineHeight: 24, marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 17 },
  doneText: { textDecorationLine: 'line-through' },
  source: { fontSize: 12, marginTop: 2 },
});
