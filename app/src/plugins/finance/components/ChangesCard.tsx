import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatBRLRounded } from '../money';
import type { CategoryChange } from '../insights';

/** Per category, a bar to the right when it rose and to the left when it fell, against the same days of last month. */
export function ChangesCard({ rows }: { rows: CategoryChange[] }) {
  const t = useTheme();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.diffCents)));
  return (
    <>
      <View style={styles.axis}>
        <Text style={[styles.axisText, { color: t.muted }]}>← gastou menos</Text>
        <Text style={[styles.axisText, { color: t.muted }]}>gastou mais →</Text>
      </View>
      {rows.map((r) => {
        const width = `${Math.max(1, (Math.abs(r.diffCents) / max) * 50)}%` as const;
        const up = r.diffCents >= 0;
        return (
          <View key={r.name} style={styles.row}>
            <View style={styles.labels}>
              <Text style={[styles.name, { color: r.uncategorized ? t.muted : t.text }]} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={[styles.value, { color: r.diffCents === 0 ? t.muted : up ? t.more : t.less }]}>
                {r.diffCents > 0 ? '+' : r.diffCents < 0 ? '−' : ''}
                {formatBRLRounded(Math.abs(r.diffCents))}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.zero, { backgroundColor: t.line }]} />
              <View style={[styles.bar, up ? { left: '50%' } : { right: '50%' }, { width, backgroundColor: up ? t.more : t.less }]} />
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 12 },
  row: { gap: 4 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  value: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 14, justifyContent: 'center' },
  zero: { position: 'absolute', left: '50%', width: 1, top: -2, bottom: -2 },
  bar: { position: 'absolute', height: 12, borderRadius: 3 },
});
