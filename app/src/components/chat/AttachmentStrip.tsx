import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { badgeOf, formatSize, type Attachment } from '@/agent/attachments';
import { useTheme } from '@/theme';

type Props = { items: Attachment[]; onRemove(item: Attachment): void };

/** The files waiting to be sent: a thumbnail per image, a card per file, each with a button to take it off. */
export function AttachmentStrip({ items, onRemove }: Props) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      {items.map((a) => (
        <View key={a.uri} style={styles.item}>
          {a.kind === 'image' ? (
            <Image source={{ uri: a.uri }} accessibilityLabel={a.name} style={[styles.thumb, { borderColor: t.line, backgroundColor: t.surface }]} />
          ) : (
            <View style={[styles.card, { backgroundColor: t.toolBg, borderColor: t.line }]}>
              <View style={[styles.badge, { backgroundColor: t.heroBg }]}>
                <Text style={[styles.badgeText, { color: t.heroHi }]}>{badgeOf(a.name)}</Text>
              </View>
              <View style={styles.meta}>
                <Text numberOfLines={1} style={[styles.name, { color: t.text }]}>
                  {a.name}
                </Text>
                <Text style={[styles.size, { color: t.muted }]}>{formatSize(a.size)}</Text>
              </View>
            </View>
          )}
          <Pressable
            onPress={() => onRemove(a)}
            accessibilityRole="button"
            accessibilityLabel={`Remover ${a.name}`}
            hitSlop={8}
            style={[styles.remove, { backgroundColor: t.text, borderColor: t.bg }]}
          >
            <Text style={[styles.removeText, { color: t.bg }]}>✕</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingTop: 8, paddingRight: 8 },
  item: { width: undefined },
  thumb: { width: 72, height: 72, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  card: { height: 72, width: 196, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  badge: { width: 36, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  badgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  meta: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700' },
  size: { fontSize: 12, marginTop: 2 },
  remove: { position: 'absolute', top: -8, right: -8, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 12, fontWeight: '900' },
});
