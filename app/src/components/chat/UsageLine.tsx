import { Pressable, StyleSheet, Text } from 'react-native';
import type { UsageSummary } from '@/core/usage';
import { formatInt, formatTpm } from '@/core/usageFormat';
import { useTheme } from '@/theme';

type Props = { usage: UsageSummary; onPress(): void };

/** The small line under a reply: input and output tokens and output speed. Tapping it opens every metric. */
export function UsageLine({ usage, onPress }: Props) {
  const t = useTheme();
  const tpm = usage.tokensPerMinute;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${formatInt(usage.inputTokens)} tokens de entrada, ${formatInt(usage.outputTokens)} de saída. Ver detalhes`}
      style={styles.root}
    >
      <Text style={[styles.text, { color: t.muted }]}>
        entrada <Text style={{ color: t.text }}>{formatInt(usage.inputTokens)}</Text>
        {'  ·  '}saída <Text style={{ color: t.text }}>{formatInt(usage.outputTokens)}</Text>
        {tpm !== null && (
          <>
            {'  ·  '}
            <Text style={{ color: t.text }}>{formatTpm(tpm).replace(' tpm', '')}</Text> tpm
          </>
        )}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'flex-start', paddingHorizontal: 2, marginTop: -4 },
  text: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
