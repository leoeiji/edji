import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

type Props = { eyebrow: string; title?: string | null; lead?: string | null; children?: ReactNode };

/** One chapter of the finance screen: a label, a sentence that says what it found, and its content. */
export function Section({ eyebrow, title, lead, children }: Props) {
  const t = useTheme();
  return (
    <View style={styles.root}>
      <Text style={[styles.eyebrow, { color: t.muted }]}>{eyebrow}</Text>
      {title ? <Text style={[styles.title, { color: t.text }]}>{title}</Text> : null}
      {lead ? <Text style={[styles.lead, { color: t.muted }]}>{lead}</Text> : null}
      {children ? <View style={[styles.card, { backgroundColor: t.surface }]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8, marginTop: 28 },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { fontSize: 22, fontWeight: '900', lineHeight: 27 },
  lead: { fontSize: 14, lineHeight: 20 },
  card: { borderRadius: 18, padding: 16, marginTop: 4, gap: 12 },
});
