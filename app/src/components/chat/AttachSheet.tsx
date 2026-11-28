import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

type Props = { onCamera(): void; onGallery(): void; onFile(): void; onClose(): void };

/** The "+" menu: where the attachment comes from. Picking one closes the sheet, then opens the system picker. */
export function AttachSheet({ onCamera, onGallery, onFile, onClose }: Props) {
  const t = useTheme();
  const options = [
    { key: 'camera', icon: '◉', title: 'Tirar foto', sub: 'Abre a câmera', run: onCamera },
    { key: 'gallery', icon: '▣', title: 'Galeria', sub: 'Uma ou mais imagens', run: onGallery },
    { key: 'file', icon: '❒', title: 'Arquivo', sub: 'PDF, texto, CSV, JSON · até 10 MB', run: onFile },
  ];
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: t.scrim }]} onPress={onClose} accessibilityLabel="Fechar" />
      <View style={[styles.sheet, { backgroundColor: t.bg }]}>
        <View style={[styles.grab, { backgroundColor: t.line }]} />
        <Text style={[styles.heading, { color: t.muted }]}>ANEXAR</Text>
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => {
              onClose();
              o.run();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${o.title}. ${o.sub}`}
            style={styles.option}
          >
            <View style={[styles.icon, { backgroundColor: t.heroBg }]}>
              <Text style={[styles.iconText, { color: t.heroHi }]}>{o.icon}</Text>
            </View>
            <View>
              <Text style={[styles.title, { color: t.text }]}>{o.title}</Text>
              <Text style={[styles.sub, { color: t.muted }]}>{o.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 4 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  heading: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 8, paddingBottom: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 8 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 20 },
  title: { fontSize: 16, fontWeight: '700' },
  sub: { fontSize: 13 },
});
