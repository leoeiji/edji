import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { canAct, statusLine } from '@/core/appUpdate';
import type { AppUpdate } from '@/hooks/useAppUpdate';
import { useTheme } from '@/theme';

type Props = { update: AppUpdate };

/** Shown above the chat when a newer version is out (ADR 0007). "Depois" hides it until the next start. */
export function UpdateBanner({ update }: Props) {
  const t = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const { check, phase, message } = update;
  if (dismissed || check?.status !== 'available') return null;
  const busy = !canAct(phase);

  return (
    <View style={[styles.root, { backgroundColor: t.heroBg }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.heroText }]}>Edji {check.release.version} disponível</Text>
        <Text style={[styles.meta, { color: message ? t.heroHi : t.heroMuted }]}>
          {message ?? (phase === 'idle' ? 'O Android pede para confirmar.' : statusLine(check, phase, update.progress))}
        </Text>
      </View>
      {!busy && (
        <Pressable onPress={() => setDismissed(true)} accessibilityRole="button" style={styles.action}>
          <Text style={{ color: t.heroMuted, fontWeight: '700' }}>Depois</Text>
        </Pressable>
      )}
      <Pressable
        onPress={update.install}
        disabled={busy}
        accessibilityRole="button"
        style={[styles.action, styles.primary, { backgroundColor: t.heroHi, opacity: busy ? 0.5 : 1 }]}
      >
        <Text style={{ color: t.heroBg, fontWeight: '800' }}>Atualizar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 16, marginTop: 8, padding: 12, paddingLeft: 16, borderRadius: 18 },
  title: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 13, marginTop: 2 },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  primary: { paddingHorizontal: 16 },
});
