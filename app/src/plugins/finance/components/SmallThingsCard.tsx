import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatBRL, formatBRLRounded } from '../money';
import type { MonthStory } from '../insights';

/** Small purchases repeated many times, and charges that come back every month, with what they cost in a year. */
export function SmallThingsCard({ small, recurring }: Pick<MonthStory, 'small' | 'recurring'>) {
  const t = useTheme();
  return (
    <>
      {small.map((s) => (
        <View key={s.description} style={styles.item}>
          <View style={styles.top}>
            <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
              {s.description}
            </Text>
            <Text style={[styles.value, { color: t.text }]}>{formatBRL(s.totalCents)}</Text>
          </View>
          <Text style={[styles.caption, { color: t.muted }]}>
            {s.count} vezes, {formatBRL(s.avgCents)} cada. No ritmo do mês, <Text style={{ color: t.more, fontWeight: '700' }}>{formatBRLRounded(s.yearlyCents)}</Text> por ano.
          </Text>
        </View>
      ))}
      {recurring.items.length > 0 && (
        <View style={[styles.item, small.length > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 }]}>
          <View style={styles.top}>
            <Text style={[styles.name, { color: t.text }]}>Contas que se repetem</Text>
            <Text style={[styles.value, { color: t.text }]}>{formatBRL(recurring.monthlyCents)}</Text>
          </View>
          {recurring.items.map((r) => (
            <View key={r.description} style={styles.top}>
              <Text style={[styles.caption, styles.grow, { color: t.muted }]} numberOfLines={1}>
                {r.description}
              </Text>
              <Text style={[styles.caption, { color: t.muted }]}>{formatBRL(r.cents)}</Text>
            </View>
          ))}
          <Text style={[styles.caption, { color: t.muted }]}>
            {formatBRLRounded(recurring.monthlyCents * 12)} por ano. Vale revisar o que ainda faz sentido.
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  item: { gap: 4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  grow: { flex: 1 },
  value: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
});
