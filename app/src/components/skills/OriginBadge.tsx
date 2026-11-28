import { StyleSheet, Text } from 'react-native';
import type { Skill } from '@/core/skills/types';
import { useTheme } from '@/theme';

type Props = { origin: Skill['origin'] };

/** Where a skill comes from: Sistema (blue), the plugin's name (amber) or Minha (green). */
export function OriginBadge({ origin }: Props) {
  const t = useTheme();
  const { label, color, bg } =
    origin.kind === 'system'
      ? { label: 'Sistema', color: t.skillSys, bg: t.skillSysBg }
      : origin.kind === 'plugin'
        ? { label: origin.pluginName, color: t.skillPlugin, bg: t.skillPluginBg }
        : { label: 'Minha', color: t.skillUser, bg: t.skillUserBg };
  return <Text style={[styles.badge, { color, backgroundColor: bg }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  badge: { fontSize: 11, fontWeight: '800', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
