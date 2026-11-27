import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { formatBRLRounded } from '../money';
import type { SplitRow } from '../insights';

/** Each category that rose, its increase split into buying more often and each purchase costing more. */
export function SplitCard({ rows }: { rows: SplitRow[] }) {
  const t = useTheme();
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r.frequencyCents) + Math.max(0, r.priceCents)));
  return (
    <>
      {rows.map((r) => (
        <View key={r.name} style={styles.row}>
          <View style={styles.top}>
            <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={[styles.value, { color: t.more }]}>+{formatBRLRounded(r.diffCents)}</Text>
          </View>
          <View style={styles.bar}>
            <View style={{ width: `${(Math.max(0, r.frequencyCents) / max) * 100}%`, backgroundColor: t.more }} />
            <View style={{ width: `${(Math.max(0, r.priceCents) / max) * 100}%`, backgroundColor: t.price }} />
          </View>
          <Text style={[styles.caption, { color: t.muted }]}>{r.caption}</Text>
        </View>
      ))}
      <View style={styles.legend}>
        <Key color={t.more} label="Por comprar mais vezes" />
        <Key color={t.price} label="Por cada compra custar mais" />
      </View>
    </>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.key}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={[styles.caption, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  value: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', height: 12, borderRadius: 3, overflow: 'hidden', gap: 2 },
  caption: { fontSize: 13 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
