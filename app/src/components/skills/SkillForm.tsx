import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { cleanInput, validateSkillInput } from '@/core/skills/store';
import { MAX_SKILL_INSTRUCTIONS, MAX_SKILL_NAME, MAX_SKILL_WHEN } from '@/core/skills/types';
import { useTheme } from '@/theme';

export type SkillDraft = { name: string; when: string; instructions: string; enabled: boolean };

type Props = {
  initial: SkillDraft;
  title: string;
  onCancel(): void;
  /** Resolves with a reason when the save failed. */
  onSave(draft: SkillDraft): Promise<string | null>;
};

/** Create or edit a user skill: name, when to use, instructions and the on switch. */
export function SkillForm({ initial, title, onCancel, onSave }: Props) {
  const t = useTheme();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<SkillDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const invalid = validateSkillInput(cleanInput(draft));
    if (invalid) return setError(invalid);
    setSaving(true);
    const reason = await onSave(draft);
    setSaving(false);
    if (reason) setError(reason);
  };

  const input = [styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.bg }];
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <Text style={[styles.label, { color: t.muted }]}>Nome</Text>
      <TextInput value={draft.name} onChangeText={(name) => set({ name })} maxLength={MAX_SKILL_NAME} accessibilityLabel="Nome da skill" style={input} />
      <Text style={[styles.label, { color: t.muted }]}>Quando usar</Text>
      <TextInput
        value={draft.when}
        onChangeText={(when) => set({ when })}
        maxLength={MAX_SKILL_WHEN}
        multiline
        accessibilityLabel="Quando usar a skill"
        style={[...input, styles.when]}
      />
      <Text style={[styles.hint, { color: t.muted }]}>O agente lê só esta frase para decidir se carrega a skill. Diga o momento do pedido, não o conteúdo.</Text>
      <Text style={[styles.label, { color: t.muted }]}>Instruções</Text>
      <TextInput
        value={draft.instructions}
        onChangeText={(instructions) => set({ instructions })}
        maxLength={MAX_SKILL_INSTRUCTIONS}
        multiline
        textAlignVertical="top"
        accessibilityLabel="Instruções da skill"
        style={[...input, styles.instructions]}
      />
      <View style={styles.switchRow}>
        <Text style={[styles.switchLabel, { color: t.text }]}>Ligada</Text>
        <Switch value={draft.enabled} onValueChange={(enabled) => set({ enabled })} accessibilityLabel="Skill ligada" />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={[styles.error, { color: t.danger }]}>
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={[styles.button, { borderColor: t.line }]}>
          <Text style={[styles.buttonText, { color: t.text }]}>Cancelar</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: t.heroBg, borderColor: t.heroBg, opacity: saving ? 0.6 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: t.heroText }]}>Salvar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  when: { minHeight: 70 },
  instructions: { minHeight: 180, fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  hint: { fontSize: 12.5, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  error: { fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  button: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
});
