import { StyleSheet, Text, View } from 'react-native';
import type { ToolPart } from '@/agent/agent';
import { skillDisplayName } from '@/core/skills/types';
import { useSkills } from '@/hooks/useSkills';
import { useTheme } from '@/theme';

type Props = { tool: ToolPart };

/**
 * The agent read a skill: one quiet line with a book mark. It never opens and
 * never shows the skill's text (ADR 0010).
 */
export function SkillReadLine({ tool }: Props) {
  const t = useTheme();
  const { skills } = useSkills();
  const id = typeof tool.input.id === 'string' ? tool.input.id : '';
  const name = skillDisplayName(id, skills ?? []);
  const failed = tool.state === 'failed';
  const verb = tool.state === 'running' ? 'Lendo a skill' : failed ? 'Não achou a skill' : 'Leu a skill';
  return (
    <View style={styles.row} accessibilityLabel={`${verb} ${name}`}>
      <Book color={failed ? t.danger : t.skillUser} />
      <Text style={[styles.text, { color: failed ? t.danger : t.muted }]} numberOfLines={1}>
        {verb} <Text style={[styles.name, { color: failed ? t.danger : t.text }]}>{name}</Text>
      </Text>
    </View>
  );
}

/** A small open book drawn with Views (the app has no SVG). */
function Book({ color }: { color: string }) {
  return (
    <View style={styles.book}>
      <View style={[styles.page, { borderColor: color, borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }]} />
      <View style={[styles.page, { borderColor: color, borderTopRightRadius: 3, borderBottomRightRadius: 3 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  text: { flex: 1, fontSize: 13 },
  name: { fontWeight: '600' },
  book: { flexDirection: 'row', width: 15, height: 12 },
  page: { flex: 1, borderWidth: 1.6 },
});
