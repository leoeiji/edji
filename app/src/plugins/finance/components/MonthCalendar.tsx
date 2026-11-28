import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '@/theme';
import { formatBRLRounded } from '../money';
import type { DayCell } from '../insights';

type Props = { days: DayCell[]; firstWeekday: number; selected: number | null; onSelect(day: number): void };

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const CELL = `${100 / 7}%` as const;

const fill = (t: Theme, level: DayCell['level']) => [t.bg, t.heat1, t.heat2, t.heat3, t.heat4][level];

/**
 * The month as a calendar colored by each day's spending (recurring charges
 * left out of the color, marked with a dot). Tapping a day selects it.
 */
export function MonthCalendar({ days, firstWeekday, selected, onSelect }: Props) {
  const t = useTheme();
  const blanks = Array.from({ length: firstWeekday }, (_, i) => <View key={`b${i}`} style={styles.slot} />);
  return (
    <View>
      <View style={styles.grid}>
        {WEEK.map((w, i) => (
          <View key={`w${i}`} style={styles.slot}>
            <Text style={[styles.week, { color: t.muted }]}>{w}</Text>
          </View>
        ))}
        {blanks}
        {days.map((d) => (
          <View key={d.day} style={styles.slot}>
            <Pressable
              disabled={d.future}
              onPress={() => onSelect(d.day)}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === d.day, disabled: d.future }}
              accessibilityLabel={`Dia ${d.day}${d.future ? ', ainda não chegou' : `, ${formatBRLRounded(d.cents)}`}`}
              style={[
                styles.cell,
                d.future ? { borderColor: t.line, borderStyle: 'dashed', borderWidth: 1 } : { backgroundColor: fill(t, d.level) },
                selected === d.day && { borderColor: t.text, borderWidth: 2 },
              ]}
            >
              <Text style={[styles.day, { color: d.level === 4 ? t.onHeat : d.future ? t.muted : t.text }]}>{d.day}</Text>
              {d.hasRecurring ? <View style={[styles.dot, { backgroundColor: d.level === 4 ? t.onHeat : t.text }]} /> : null}
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.scale}>
        <Text style={[styles.scaleText, { color: t.muted }]}>Menos</Text>
        {([1, 2, 3, 4] as const).map((l) => (
          <View key={l} style={[styles.swatch, { backgroundColor: fill(t, l) }]} />
        ))}
        <Text style={[styles.scaleText, { color: t.muted }]}>Mais · ponto: conta que se repete</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { width: CELL, padding: 2 },
  week: { textAlign: 'center', fontSize: 11, fontWeight: '700', paddingBottom: 2 },
  cell: { aspectRatio: 1, borderRadius: 8, padding: 4, justifyContent: 'space-between' },
  day: { fontSize: 12, fontWeight: '700' },
  dot: { width: 5, height: 5, borderRadius: 3, alignSelf: 'flex-end', opacity: 0.6 },
  scale: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, flexWrap: 'wrap' },
  scaleText: { fontSize: 12 },
  swatch: { width: 14, height: 10, borderRadius: 2 },
});
