import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/** Screen title with the button that opens the side panel. */
export function Header({ title, onMenu }: { title: string; onMenu(): void }) {
  const t = useTheme();
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Abrir menu" hitSlop={12} onPress={onMenu} style={styles.menu}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.menuBar, { backgroundColor: t.text }]} />
        ))}
      </Pressable>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  menu: { gap: 4, paddingVertical: 4 },
  menuBar: { width: 20, height: 2.5, borderRadius: 2 },
  title: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
});
