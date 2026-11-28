import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Skill } from '@/core/skills/types';
import { useTheme } from '@/theme';
import { OriginBadge } from './OriginBadge';

type Props = { skill: Skill; onPress(): void };

/** One skill in the list: name, origin, when to use and (for the user's own) who made it. */
export function SkillCard({ skill, onPress }: Props) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${skill.name}${skill.enabled ? '' : ', desligada'}`}
      style={[styles.card, { backgroundColor: t.toolBg, borderColor: t.line, opacity: skill.enabled ? 1 : 0.55 }]}
    >
      <View style={styles.top}>
        <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
          {skill.name}
        </Text>
        <OriginBadge origin={skill.origin} />
      </View>
      <Text style={[styles.when, { color: t.muted }]} numberOfLines={2}>
        {skill.when}
      </Text>
      {skill.editable && (
        <Text style={[styles.meta, { color: t.muted }]}>
          {skill.enabled ? '' : 'Desligada · '}
          {skill.createdBy === 'agent' ? 'Criada pelo agente' : 'Criada por você'}
        </Text>
      )}
      {!skill.editable && !skill.enabled && <Text style={[styles.meta, { color: t.muted }]}>Plugin desligado</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 11, gap: 5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  when: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 12 },
});
