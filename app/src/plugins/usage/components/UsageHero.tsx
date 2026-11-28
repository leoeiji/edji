import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatCost, formatTokensShort } from '@/core/usageFormat';
import { useTheme } from '@/theme';
import { monthName, type UsageStory } from '../insights';

type Props = {
  year: number;
  month: number;
  story: UsageStory;
  canGoBack: boolean;
  canGoNext: boolean;
  onPrevious(): void;
  onNext(): void;
};

/** Pine card that opens the screen: the month, its headline and the input, output and cost totals. */
export function UsageHero({ year, month, story, canGoBack, canGoNext, onPrevious, onNext }: Props) {
  const t = useTheme();
  const { totals } = story;
  return (
    <View style={[styles.root, { backgroundColor: t.heroBg }]}>
      <View style={styles.nav}>
        <Pressable onPress={onPrevious} disabled={!canGoBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Mês anterior">
          <Text style={[styles.arrow, { color: t.heroText, opacity: canGoBack ? 1 : 0.25 }]}>‹</Text>
        </Pressable>
        <Text style={[styles.month, { color: t.heroMuted }]}>{monthName(year, month)}</Text>
        <Pressable onPress={onNext} disabled={!canGoNext} hitSlop={12} accessibilityRole="button" accessibilityLabel="Próximo mês">
          <Text style={[styles.arrow, { color: t.heroText, opacity: canGoNext ? 1 : 0.25 }]}>›</Text>
        </Pressable>
      </View>
      <Text style={[styles.headline, { color: t.heroText }]}>{story.headline}</Text>
      {story.sub ? <Text style={[styles.sub, { color: t.heroMuted }]}>{story.sub}</Text> : null}
      <View style={[styles.stats, { borderTopColor: t.heroMuted }]}>
        <Stat label="Entrada" value={formatTokensShort(totals.inputTokens)} />
        <Stat label="Saída" value={formatTokensShort(totals.outputTokens)} />
        <Stat label="Custo" value={totals.cost === null ? '—' : formatCost(totals.cost)} highlight />
      </View>
    </View>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: t.heroMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: highlight ? t.heroHi : t.heroText }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderRadius: 24, padding: 20, gap: 12 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { fontSize: 28, fontWeight: '700', paddingHorizontal: 4, lineHeight: 30 },
  month: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  headline: { fontSize: 26, fontWeight: '900', lineHeight: 31 },
  sub: { fontSize: 14, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 4 },
  stat: { flex: 1, gap: 2 },
  statLabel: { fontSize: 12, fontWeight: '700' },
  statValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
