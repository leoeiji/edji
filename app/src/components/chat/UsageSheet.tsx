import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { toolLabel } from '@/core/registry';
import { summarize, type UsageStep } from '@/core/usage';
import { formatCost, formatInt, formatMs, formatTpm } from '@/core/usageFormat';
import { PLUGINS } from '@/plugins';
import { useTheme } from '@/theme';

type Props = {
  steps: UsageStep[];
  /** Tool names by call id, for the per-tool times. */
  toolNames: Record<string, string>;
  onClose(): void;
};

/** Every metric of one reply, summed over its steps, then step by step when there were several. */
export function UsageSheet({ steps, toolNames, onClose }: Props) {
  const t = useTheme();
  const u = summarize(steps);
  const toolCount = steps.reduce((n, s) => n + Object.keys(s.toolMs).length, 0);
  const sub = [
    steps.length === 1 ? '1 passo' : `${steps.length} passos`,
    toolCount === 0 ? null : toolCount === 1 ? '1 tool' : `${toolCount} tools`,
    u.finishReason ? `terminou com ${u.finishReason}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const tools = steps.flatMap((s) => Object.entries(s.toolMs));
  const gap = steps.map((s) => s.chunkGapMs).find((g) => g !== null) ?? null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: t.scrim }]} onPress={onClose} accessibilityLabel="Fechar" />
      <View style={[styles.sheet, { backgroundColor: t.bg }]}>
        <View style={[styles.grab, { backgroundColor: t.line }]} />
        <Text style={[styles.title, { color: t.text }]}>Esta resposta</Text>
        <Text style={[styles.sub, { color: t.muted }]}>{sub}</Text>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          <Row label="Modelo" value={u.models.join(', ')} mono />
          <Row label="Provedor" value={u.upstreamProviders.length ? u.upstreamProviders.join(', ') : steps[0]?.provider ?? '—'} note={u.upstreamProviders.length ? `via ${steps[0]?.provider}` : undefined} />

          <Group title="Tokens" />
          <Row label="Entrada" value={formatInt(u.inputTokens)} note={u.cacheReadTokens ? `${formatInt(u.cacheReadTokens)} do cache` : undefined} />
          {u.cacheWriteTokens > 0 && <Row label="Gravados no cache" value={formatInt(u.cacheWriteTokens)} />}
          <Row label="Saída" value={formatInt(u.outputTokens)} note={`${formatInt(u.reasoningTokens)} de raciocínio`} />
          <Row label="Total" value={formatInt(u.totalTokens)} />
          {u.cost !== null && <Row label="Custo" value={formatCost(u.cost)} />}

          <Group title="Tempo" />
          {u.firstOutputMs !== null && <Row label="Primeiro texto" value={formatMs(u.firstOutputMs)} />}
          <Row label="Resposta completa" value={formatMs(u.totalMs)} />
          {tools.map(([id, ms]) => (
            <Row key={id} label={toolNames[id] ? toolLabel(PLUGINS, toolNames[id]) : 'Tool'} value={formatMs(ms)} />
          ))}
          {u.tokensPerMinute !== null && <Row label="Velocidade" value={formatTpm(u.tokensPerMinute)} note={`${formatInt(u.tokensPerMinute / 60)}/s`} />}
          {gap && <Row label="Entre partes" value={formatMs(gap.median)} note={`mediana · p90 ${formatMs(gap.p90)}`} />}

          {steps.length > 1 && (
            <>
              <Group title="Passo a passo" />
              {steps.map((s, i) => (
                <Row
                  key={s.id}
                  label={`${i + 1}. ${s.error ? 'falhou' : s.finishReason ?? ''}`}
                  value={s.error ? s.error : `${formatInt(s.inputTokens ?? 0)} → ${formatInt(s.outputTokens ?? 0)}`}
                  note={s.stepMs !== null ? formatMs(s.stepMs) : undefined}
                />
              ))}
            </>
          )}

          {steps.some((s) => s.responseId) && (
            <>
              <Group title="Identificação" />
              {steps.map((s) => s.responseId).filter((id): id is string => Boolean(id)).map((id) => (
                <Text key={id} selectable style={[styles.id, { color: t.muted }]}>
                  {id}
                </Text>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Group({ title }: { title: string }) {
  const t = useTheme();
  return <Text style={[styles.group, { color: t.muted, borderTopColor: t.line }]}>{title}</Text>;
}

function Row({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: t.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[mono ? styles.mono : styles.value, { color: t.text }]} selectable numberOfLines={2}>
        {value}
        {note ? <Text style={{ color: t.muted, fontWeight: '400' }}>{`  ·  ${note}`}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: 6, maxHeight: '80%' },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  title: { fontSize: 20, fontWeight: '900' },
  sub: { fontSize: 13 },
  scroll: { flexGrow: 0 },
  list: { gap: 8, paddingTop: 8 },
  group: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: 14, alignItems: 'baseline' },
  label: { fontSize: 14 },
  value: { flex: 1, fontSize: 14, fontWeight: '500', textAlign: 'right', fontVariant: ['tabular-nums'] },
  mono: { flex: 1, fontFamily: 'monospace', fontSize: 12, textAlign: 'right' },
  id: { fontFamily: 'monospace', fontSize: 12 },
});
