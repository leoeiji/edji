import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PluginContext } from '@/core/plugin';
import { formatCost, formatInt, formatMs, formatTokensShort, formatTpm } from '@/core/usageFormat';
import { useTheme } from '@/theme';
import { DailyChart } from './components/DailyChart';
import { Section } from './components/Section';
import { UsageHero } from './components/UsageHero';
import { useUsage } from './useUsage';

/**
 * A month of the model's token use, computed on the device from the core's
 * `usage_steps` (ADR 0008): totals and cost, each day, input against output,
 * where the tokens go, which models and providers served them, speed, and
 * the conversations that used the most.
 */
export function UsageView({ ctx }: { ctx: PluginContext }) {
  const t = useTheme();
  const u = useUsage(ctx);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await u.reload();
    setRefreshing(false);
  };

  const { data, story } = u;
  if (!data || !story) return null;
  const has = story.totals.totalTokens > 0;
  const peak = story.peak;

  return (
    <ScrollView contentContainerStyle={styles.root} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <UsageHero
        year={data.year}
        month={data.month}
        story={story}
        canGoBack={u.canGoBack}
        canGoNext={!u.isCurrent}
        onPrevious={u.previousMonth}
        onNext={u.nextMonth}
      />

      {!has && (
        <Text style={[styles.hint, { color: t.text }]}>
          Nada contado neste mês. Cada pergunta ao modelo, no chat, na voz, numa rotina ou no título de uma conversa, aparece aqui.
        </Text>
      )}

      {has && (
        <Section eyebrow="Por dia" title={peak ? `O dia ${peak.day} foi o maior: ${formatTokensShort(peak.tokens)} tokens.` : null}>
          <DailyChart days={story.days} />
        </Section>
      )}

      {has && (
        <Section
          eyebrow="Entrada e saída"
          title={`${Math.round(story.inputShare * 100)}% dos tokens são de entrada.`}
          lead={`Cada pedido leva o histórico da conversa e os tools dos plugins ligados. Média de ${formatInt(story.avgInputPerStep)} tokens de entrada por pedido${
            story.cacheShare > 0 ? `; ${Math.round(story.cacheShare * 100)}% da entrada veio do cache` : ''
          }.`}
        />
      )}

      {story.sources.length > 0 && (
        <Section eyebrow="Origem" title={`${story.sources[0].label.split(' · ')[0]} leva ${Math.round(story.sources[0].share * 100)}%.`}>
          {story.sources.map((s) => (
            <View key={s.source} style={styles.bar}>
              <View style={styles.barHead}>
                <Text style={[styles.barLabel, { color: t.text }]}>{s.label}</Text>
                <Text style={[styles.num, { color: t.text }]}>{formatTokensShort(s.tokens)}</Text>
              </View>
              <View style={[styles.track, { backgroundColor: t.line }]}>
                <View style={{ width: `${Math.max(1, s.share * 100)}%`, backgroundColor: t.usageIn }} />
              </View>
            </View>
          ))}
        </Section>
      )}

      {story.models.length > 0 && (
        <Section eyebrow="Modelos e provedores">
          {story.models.map((m) => (
            <View key={m.model} style={styles.modelRow}>
              <View style={styles.barHead}>
                <Text style={[styles.mono, { color: t.text }]} numberOfLines={1}>
                  {m.model}
                </Text>
                <Text style={[styles.num, { color: t.text }]}>{m.cost === null ? formatTokensShort(m.tokens) : formatCost(m.cost)}</Text>
              </View>
              <Text style={[styles.meta, { color: t.muted }]}>
                {formatTokensShort(m.tokens)} tokens
                {m.providers.length > 0 && ` · ${m.providers.map((p) => `${p.name} ${Math.round(p.share * 100)}%`).join(', ')}`}
              </Text>
            </View>
          ))}
        </Section>
      )}

      {has && (
        <Section eyebrow="Velocidade">
          <View style={styles.pills}>
            <Pill
              label="Primeiro texto"
              value={story.speed.firstOutputMedianMs === null ? '—' : formatMs(story.speed.firstOutputMedianMs)}
              note={story.speed.firstOutputP90Ms === null ? 'mediana' : `mediana · p90 ${formatMs(story.speed.firstOutputP90Ms)}`}
            />
            <Pill
              label="Saída"
              value={story.speed.tpmMedian === null ? '—' : formatTpm(story.speed.tpmMedian)}
              note={story.speed.tpmP10 === null ? 'mediana' : `mediana · p10 ${formatInt(story.speed.tpmP10)}`}
            />
            <Pill label="Cache" value={`${Math.round(story.cacheShare * 100)}%`} note="da entrada" />
            <Pill label="Falhas" value={formatInt(story.totals.failed)} note={`de ${formatInt(story.totals.steps)} pedidos`} />
          </View>
        </Section>
      )}

      {story.conversations.length > 0 && (
        <Section eyebrow="Conversas que mais gastaram">
          {story.conversations.map((c, i) => (
            <View
              key={c.conversationId}
              style={[styles.conv, i < story.conversations.length - 1 && { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }]}
            >
              <View style={styles.barHead}>
                <Text style={[styles.barLabel, { color: t.text }]} numberOfLines={1}>
                  {c.title}
                </Text>
                <Text style={[styles.num, { color: t.text }]}>{formatTokensShort(c.tokens)}</Text>
              </View>
              <Text style={[styles.meta, { color: t.muted }]}>
                {dayLabel(c.lastAt)} · {c.steps === 1 ? '1 pedido' : `${c.steps} pedidos`}
                {c.cost !== null && ` · ${formatCost(c.cost)}`}
              </Text>
            </View>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Pill({ label, value, note }: { label: string; value: string; note: string }) {
  const t = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillLabel, { color: t.muted }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.pillNote, { color: t.muted }]}>{note}</Text>
    </View>
  );
}

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dayLabel(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} de ${MONTHS_SHORT[d.getMonth()]}`;
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: 48 },
  hint: { fontSize: 14, lineHeight: 20, marginTop: 20 },
  bar: { gap: 6 },
  barHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  barLabel: { flex: 1, fontSize: 15 },
  num: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  modelRow: { gap: 2 },
  mono: { flex: 1, fontFamily: 'monospace', fontSize: 13 },
  meta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexBasis: '47%', flexGrow: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  pillLabel: { fontSize: 12, fontWeight: '700' },
  pillValue: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pillNote: { fontSize: 11, fontVariant: ['tabular-nums'] },
  conv: { gap: 2, paddingBottom: 10 },
});
