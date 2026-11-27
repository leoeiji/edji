import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

type Props = {
  title: string;
  onMenu(): void;
  /** A conversation title: smaller, one line, so long ones fit. */
  compact?: boolean;
  /** Starts a new conversation; shown on the chat. */
  onNew?(): void;
};

/** Screen title with the button that opens the side panel. */
export function Header({ title, onMenu, compact, onNew }: Props) {
  const t = useTheme();
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Abrir menu" hitSlop={12} onPress={onMenu} style={styles.menu}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.menuBar, { backgroundColor: t.text }]} />
        ))}
      </Pressable>
      <Text style={[compact ? styles.compact : styles.title, { color: t.text }]} numberOfLines={1}>
        {title}
      </Text>
      {onNew && (
        <Pressable accessibilityLabel="Nova conversa" accessibilityRole="button" hitSlop={12} onPress={onNew} style={styles.new}>
          <View style={[styles.plusH, { backgroundColor: t.text }]} />
          <View style={[styles.plusV, { backgroundColor: t.text }]} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  menu: { gap: 4, paddingVertical: 4 },
  menuBar: { width: 20, height: 2.5, borderRadius: 2 },
  title: { flex: 1, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  compact: { flex: 1, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  new: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  plusH: { position: 'absolute', width: 18, height: 2.5, borderRadius: 2 },
  plusV: { position: 'absolute', width: 2.5, height: 18, borderRadius: 2 },
});
