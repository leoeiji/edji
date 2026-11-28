import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { Skill } from '@/core/skills/types';
import { useTheme } from '@/theme';
import { OriginBadge } from './OriginBadge';

type Props = {
  skill: Skill;
  onToggle(enabled: boolean): void;
  onEdit(): void;
  onDelete(): void;
  /** Opens the form with a copy of this skill, to edit as the user's own. */
  onCopy(): void;
};

/** A skill's text. System and plugin skills are read-only with a lock note and "Criar cópia"; the user's can be edited, switched off or deleted. */
export function SkillDetail({ skill, onToggle, onEdit, onDelete, onCopy }: Props) {
  const t = useTheme();
  const [confirming, setConfirming] = useState(false);
  const source = skill.origin.kind === 'plugin' ? `do plugin ${skill.origin.pluginName}` : 'do Edji';

  return (
    <View style={styles.wrap}>
      <View style={styles.kicker}>
        <OriginBadge origin={skill.origin} />
        {skill.createdBy && (
          <Text style={[styles.meta, { color: t.muted }]}>{skill.createdBy === 'agent' ? 'criada pelo agente' : 'criada por você'}</Text>
        )}
      </View>
      <Text style={[styles.name, { color: t.text }]}>{skill.name}</Text>
      <Text style={[styles.when, { color: t.muted }]}>{skill.when}</Text>

      {!skill.editable && (
        <View style={[styles.note, { backgroundColor: skill.origin.kind === 'plugin' ? t.skillPluginBg : t.skillSysBg }]}>
          <Text style={[styles.noteText, { color: t.text }]}>
            Somente leitura. Vem {source} e muda quando ele atualizar. Nem você nem o agente podem editar. Para ajustar, crie uma cópia sua.
            {!skill.enabled ? ' O plugin está desligado, então o agente não vê esta skill.' : ''}
          </Text>
        </View>
      )}

      {skill.editable && (
        <View style={[styles.switchRow, { backgroundColor: t.toolBg }]}>
          <View style={styles.switchText}>
            <Text style={[styles.switchLabel, { color: t.text }]}>Ligada</Text>
            <Text style={[styles.meta, { color: t.muted }]}>Aparece no catálogo do agente</Text>
          </View>
          <Switch value={skill.enabled} onValueChange={onToggle} accessibilityLabel="Skill ligada" />
        </View>
      )}

      <Text style={[styles.label, { color: t.muted }]}>Instruções</Text>
      <View style={[styles.text, { backgroundColor: t.toolBg, borderColor: t.line }]}>
        <Text selectable style={[styles.mono, { color: t.text }]}>
          {skill.instructions}
        </Text>
      </View>

      <Text style={[styles.meta, { color: t.muted }]}>
        {skill.editable ? `Carregada ${skill.loadCount ?? 0} ${skill.loadCount === 1 ? 'vez' : 'vezes'} · ` : ''}
        {skill.id}
      </Text>

      <View style={styles.actions}>
        {skill.editable ? (
          confirming ? (
            <>
              <Text style={[styles.confirm, { color: t.text }]}>Apagar esta skill? Não dá para desfazer.</Text>
              <Pressable onPress={() => setConfirming(false)} accessibilityRole="button" style={[styles.button, { borderColor: t.line }]}>
                <Text style={[styles.buttonText, { color: t.text }]}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={onDelete} accessibilityRole="button" style={[styles.button, { borderColor: t.danger }]}>
                <Text style={[styles.buttonText, { color: t.danger }]}>Apagar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => setConfirming(true)} accessibilityRole="button" style={[styles.button, { borderColor: t.line }]}>
                <Text style={[styles.buttonText, { color: t.danger }]}>Apagar</Text>
              </Pressable>
              <Pressable onPress={onEdit} accessibilityRole="button" style={[styles.button, { backgroundColor: t.heroBg, borderColor: t.heroBg }]}>
                <Text style={[styles.buttonText, { color: t.heroText }]}>Editar</Text>
              </Pressable>
            </>
          )
        ) : (
          <Pressable onPress={onCopy} accessibilityRole="button" style={[styles.button, { backgroundColor: t.heroBg, borderColor: t.heroBg }]}>
            <Text style={[styles.buttonText, { color: t.heroText }]}>Criar cópia para editar</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 24, fontWeight: '800' },
  when: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 12 },
  note: { borderRadius: 12, padding: 12, marginTop: 4 },
  noteText: { fontSize: 13, lineHeight: 19 },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 15, fontWeight: '700' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 10 },
  text: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 21 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  confirm: { flexBasis: '100%', fontSize: 14 },
  button: { flex: 1, minWidth: 110, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  buttonText: { fontSize: 15, fontWeight: '700' },
});
