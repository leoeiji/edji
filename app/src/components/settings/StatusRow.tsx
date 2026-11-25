import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { settingsStyles as styles } from './styles';

/** A setup requirement with a button to fix it while it is missing. */
export function StatusRow({ label, ok, action, onPress }: { label: string; ok: boolean | null; action: string; onPress(): void }) {
  const t = useTheme();
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.label, { color: t.text, flex: 1 }]}>
        {ok ? '✓ ' : '• '}
        {label}
      </Text>
      {ok === false && (
        <Pressable onPress={onPress} style={[styles.button, { borderColor: t.accent }]}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

