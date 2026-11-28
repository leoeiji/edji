import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import type { CategoryTarget } from '../tools';
import { MAX_CATEGORY_LENGTH, type Category, type Transaction } from '../transaction';
import { Sheet, sheetStyles as s } from './Sheet';

type Props = {
  tx: Transaction;
  categories: Category[];
  onClose(): void;
  /** Returns an error to show, or null when done. */
  onPick(target: CategoryTarget, name: string | null): Promise<string | null>;
};

/** Puts an entry (or every entry with its description) in a category, creates one, or takes it out of any. */
export function CategoryPicker({ tx, categories, onClose, onPick }: Props) {
  const t = useTheme();
  const [onlyThis, setOnlyThis] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const target: CategoryTarget = onlyThis ? { id: tx.id } : { description: tx.description };
  const pick = async (name: string | null) => setError(await onPick(target, name));

  return (
    <Sheet onClose={onClose}>
      <Text style={[s.title, { color: t.text }]} numberOfLines={2}>
        {tx.description}
      </Text>

      <View style={[styles.segment, { backgroundColor: t.surface }]}>
        {[false, true].map((only) => (
          <Pressable
            key={String(only)}
            onPress={() => setOnlyThis(only)}
            accessibilityRole="button"
            accessibilityState={{ selected: onlyThis === only }}
            style={[styles.segmentItem, onlyThis === only && { backgroundColor: t.accent }]}
          >
            <Text style={[styles.segmentText, { color: onlyThis === only ? t.onAccent : t.muted }]}>
              {only ? 'Só este registro' : 'Todos desta descrição'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.note, { color: t.muted }]}>
        {onlyThis ? 'Os outros registros não mudam.' : 'Vale para os registros já anotados e para os próximos com essa descrição.'}
      </Text>

      <View style={s.chips}>
        {categories.map((c) => {
          const current = c.id === tx.categoryId;
          return (
            <Pressable
              key={c.id}
              onPress={() => pick(c.name)}
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              style={[s.chip, current ? { backgroundColor: t.accent, borderColor: t.accent } : { borderColor: t.line }]}
            >
              <Text style={[s.chipText, { color: current ? t.onAccent : t.text }]}>{c.name}</Text>
            </Pressable>
          );
        })}
        {tx.categoryId !== null && (
          <Pressable onPress={() => pick(null)} accessibilityRole="button" style={[s.chip, s.dashed, { borderColor: t.line }]}>
            <Text style={[s.chipText, { color: t.muted }]}>Sem categoria</Text>
          </Pressable>
        )}
      </View>

      <View style={s.row}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder={categories.length ? 'Nova categoria' : 'Primeira categoria, ex.: Mercado'}
          placeholderTextColor={t.muted}
          maxLength={MAX_CATEGORY_LENGTH}
          returnKeyType="done"
          onSubmitEditing={() => newName.trim() && pick(newName)}
          style={[s.input, { color: t.text, borderColor: t.line, backgroundColor: t.surface }]}
        />
        <Pressable
          onPress={() => pick(newName)}
          disabled={!newName.trim()}
          accessibilityRole="button"
          style={[s.button, { backgroundColor: t.accent, opacity: newName.trim() ? 1 : 0.4 }]}
        >
          <Text style={[s.chipText, { color: t.onAccent }]}>Criar</Text>
        </Pressable>
      </View>
      {error ? <Text style={[s.note, { color: t.danger }]}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: 999, padding: 4, gap: 4 },
  segmentItem: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  segmentText: { fontSize: 13, fontWeight: '700' },
});
