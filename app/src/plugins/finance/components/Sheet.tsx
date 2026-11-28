import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';

/** A bottom sheet over a scrim; tapping the scrim or back closes it. */
export function Sheet({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const t = useTheme();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: t.scrim }]} onPress={onClose} accessibilityLabel="Fechar" />
      <View style={[styles.sheet, { backgroundColor: t.bg }]}>{children}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 14 },
});

export const sheetStyles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '900' },
  note: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  dashed: { borderStyle: 'dashed' },
  chipText: { fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  button: { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
});
