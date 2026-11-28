import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { badgeOf, formatSize, type Attachment } from '@/agent/attachments';
import { useTheme } from '@/theme';

type Props = { items: Attachment[] };

/**
 * The files of a sent message, inside the user's bubble: images as pictures
 * (tap to see one whole), the rest as cards. Colors follow the bubble.
 */
export function AttachmentList({ items }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState<Attachment | null>(null);
  return (
    <View style={styles.list}>
      {items.map((a) =>
        a.kind === 'image' ? (
          <Pressable key={a.uri} onPress={() => setOpen(a)} accessibilityRole="imagebutton" accessibilityLabel={`Abrir imagem ${a.name}`}>
            <Image source={{ uri: a.uri }} style={[styles.image, { backgroundColor: t.surface }]} resizeMode="cover" />
          </Pressable>
        ) : (
          <View key={a.uri} style={styles.file} accessible accessibilityLabel={`Arquivo ${a.name}, ${formatSize(a.size)}`}>
            <View style={[styles.fileFill, { backgroundColor: t.onUserBubble }]} />
            <View style={[styles.badge, { backgroundColor: t.heroHi }]}>
              <Text style={[styles.badgeText, { color: t.heroBg }]}>{badgeOf(a.name)}</Text>
            </View>
            <View style={styles.meta}>
              <Text numberOfLines={1} style={[styles.name, { color: t.onUserBubble }]}>
                {a.name}
              </Text>
              <Text style={[styles.size, { color: t.heroMuted }]}>{formatSize(a.size)}</Text>
            </View>
          </View>
        ),
      )}
      {open && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(null)}>
          <Pressable style={[styles.viewer, { backgroundColor: t.scrim }]} onPress={() => setOpen(null)} accessibilityLabel="Fechar imagem">
            <Image source={{ uri: open.uri }} style={styles.full} resizeMode="contain" accessibilityLabel={open.name} />
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  image: { width: 216, height: 150, borderRadius: 14 },
  file: { width: 216, height: 52, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8, paddingRight: 12, overflow: 'hidden' },
  fileFill: { ...StyleSheet.absoluteFill, opacity: 0.12 },
  badge: { width: 28, height: 36, borderRadius: 5, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 5 },
  badgeText: { fontSize: 9, fontWeight: '900' },
  meta: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700' },
  size: { fontSize: 12 },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  full: { width: '100%', height: '100%' },
});
