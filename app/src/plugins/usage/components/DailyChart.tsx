import { StyleSheet, Text, View } from 'react-native';
import { formatTokensShort } from '@/core/usageFormat';
import { useTheme } from '@/theme';
import type { DayTokens } from '../insights';

const CHART_HEIGHT = 110;

type Props = { days: DayTokens[] };

/** One stacked bar per day (fresh input, cached input, output), drawn with views: the app has no SVG. */
export function DailyChart({ days }: Props) {
  const t = useTheme();
  const max = Math.max(1, ...days.map((d) => d.fresh + d.cache + d.output));
  const ticks = [1, 8, 15, 22, days.length];
  return (
    <View style={styles.root}>
      <View style={styles.bars}>
        {days.map((d) => {
          const total = d.fresh + d.cache + d.output;
          if (total === 0) return <View key={d.day} style={[styles.empty, { backgroundColor: t.line }]} />;
          return (
            <View
              key={d.day}
              accessible
              accessibilityLabel={`Dia ${d.day}: ${formatTokensShort(total)} tokens`}
              style={[styles.bar, { height: Math.max(2, (total / max) * CHART_HEIGHT) }]}
            >
              <View style={{ flex: d.output, backgroundColor: t.usageOut }} />
              <View style={{ flex: d.cache, backgroundColor: t.usageCache }} />
              <View style={{ flex: d.fresh, backgroundColor: t.usageIn }} />
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        {ticks.map((d) => (
          <Text key={d} style={[styles.tick, { color: t.muted }]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.legend}>
        <Legend color={t.usageIn} label="Entrada" />
        <Legend color={t.usageCache} label="Entrada do cache" />
        <Legend color={t.usageOut} label="Saída" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={[styles.tick, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: CHART_HEIGHT },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, overflow: 'hidden' },
  empty: { flex: 1, height: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { fontSize: 11, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 9, height: 9, borderRadius: 2 },
});
