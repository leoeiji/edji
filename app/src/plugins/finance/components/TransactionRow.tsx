import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatWhen } from '@/plugins/routines/format';
import { useTheme } from '@/theme';
import { formatBRL } from '../money';
import type { Transaction } from '../transaction';

/** One entry; tapping it picks its category. Without one, the chip is dashed. */
export function TransactionRow({ tx, onPress, last }: { tx: Transaction; onPress(): void; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Escolher a categoria"
      style={[styles.row, !last && { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }]}
    >
      <View style={styles.text}>
        <Text style={[styles.description, { color: t.text }]} numberOfLines={1}>
          {tx.description}
        </Text>
        <Text style={[styles.meta, { color: t.muted }]}>
          {[formatWhen(tx.occurredAt), tx.account, tx.source === 'routine' ? 'rotina' : null].filter(Boolean).join(' · ')}
        </Text>
        <Text
          style={[
            styles.category,
            tx.category ? { color: t.accent, borderColor: t.accent } : { color: t.muted, borderColor: t.line, borderStyle: 'dashed' },
          ]}
        >
          {tx.category ?? 'Sem categoria'}
        </Text>
      </View>
      <Text style={[styles.amount, { color: tx.direction === 'in' ? t.accent : t.text }]}>
        {tx.direction === 'in' ? '+' : '−'}
        {formatBRL(tx.amountCents)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  text: { flex: 1, gap: 2, alignItems: 'flex-start' },
  description: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13 },
  category: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, marginTop: 4 },
  amount: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
