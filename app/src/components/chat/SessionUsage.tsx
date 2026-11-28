import { StyleSheet, Text, View } from 'react-native';
import type { UsageSummary } from '@/core/usage';
import { formatCost, formatInt } from '@/core/usageFormat';
import { useTheme } from '@/theme';

type Props = { usage: UsageSummary };

/** Tokens used by the open conversation so far, split between input and output, with the cost when the provider gives it. */
export function SessionUsage({ usage }: Props) {
  const t = useTheme();
  const total = usage.inputTokens + usage.outputTokens;
  const inShare = total > 0 ? usage.inputTokens / total : 0;
  return (
    <View
      style={[styles.root, { backgroundColor: t.surface }]}
      accessible
      accessibilityLabel={`Sessão: ${formatInt(total)} tokens, ${formatInt(usage.inputTokens)} de entrada e ${formatInt(usage.outputTokens)} de saída`}
    >
      <Text style={[styles.label, { color: t.muted }]}>Sessão</Text>
      <Text style={[styles.total, { color: t.text }]}>{formatInt(total)} tokens</Text>
      <View style={[styles.split, { backgroundColor: t.line }]}>
        <View style={{ flex: inShare, backgroundColor: t.usageIn }} />
        <View style={{ flex: 1 - inShare, backgroundColor: t.usageOut }} />
      </View>
      {usage.cost !== null && <Text style={[styles.label, { color: t.muted }]}>{formatCost(usage.cost)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  label: { fontSize: 12, fontVariant: ['tabular-nums'] },
  total: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  split: { flex: 1, minWidth: 40, height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' },
});
