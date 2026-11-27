import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';
import { MAX_CATEGORY_LENGTH, type CategoryWithCount } from '../transaction';
import { Sheet, sheetStyles as s } from './Sheet';

type Props = {
  category: CategoryWithCount;
  onClose(): void;
  /** Returns an error to show, or null when done. */
  onRename(to: string): Promise<string | null>;
  onDelete(): Promise<void>;
};

/** Renames a category (a name in use merges the two) or deletes it, keeping its entries. Deleting asks first, in the sheet. */
export function CategoryEditor({ category, onClose, onRename, onDelete }: Props) {
  const t = useTheme();
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() && name.trim() !== category.name;
  const entries = category.count === 1 ? '1 registro fica' : `${category.count} registros ficam`;

  return (
    <Sheet onClose={onClose}>
      <Text style={[s.title, { color: t.text }]}>{category.name}</Text>
      <Text style={[s.note, { color: t.muted }]}>
        {category.count === 1 ? '1 registro' : `${category.count} registros`}. Usar o nome de outra categoria junta as duas.
      </Text>
      <View style={s.row}>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={MAX_CATEGORY_LENGTH}
          returnKeyType="done"
          onSubmitEditing={async () => changed && setError(await onRename(name))}
          accessibilityLabel="Nome da categoria"
          style={[s.input, { color: t.text, borderColor: t.line, backgroundColor: t.surface }]}
        />
        <Pressable
          onPress={async () => setError(await onRename(name))}
          disabled={!changed}
          accessibilityRole="button"
          style={[s.button, { backgroundColor: t.accent, opacity: changed ? 1 : 0.4 }]}
        >
          <Text style={[s.chipText, { color: t.onAccent }]}>Salvar</Text>
        </Pressable>
      </View>
      {error ? <Text style={[s.note, { color: t.danger }]}>{error}</Text> : null}

      {confirming ? (
        <View style={{ gap: 10 }}>
          <Text style={[s.note, { color: t.text }]}>
            Apagar {category.name}? {entries} sem categoria; nenhum registro é apagado.
          </Text>
          <View style={s.row}>
            <Pressable onPress={() => setConfirming(false)} accessibilityRole="button" style={[s.button, { flex: 1, backgroundColor: t.surface }]}>
              <Text style={[s.chipText, { color: t.text }]}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={onDelete} accessibilityRole="button" style={[s.button, { flex: 1, backgroundColor: t.danger }]}>
              <Text style={[s.chipText, { color: t.bg }]}>Apagar</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setConfirming(true)} accessibilityRole="button" style={[s.button, { borderWidth: 1.5, borderColor: t.line }]}>
          <Text style={[s.chipText, { color: t.danger }]}>Apagar categoria</Text>
        </Pressable>
      )}
    </Sheet>
  );
}
