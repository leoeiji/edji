import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Destination } from '@/navigation/destinations';
import { useTheme } from '@/theme';

type Props = {
  destinations: Destination[];
  activeKey: string;
  /** Index before which a divider separates the plugin views from the fixed screens. */
  dividerAt: number;
  onSelect(key: string): void;
  onClose(): void;
};

/** Side panel over the current screen, closed by tapping the scrim. */
export function SidePanel({ destinations, activeKey, dividerAt, onSelect, onClose }: Props) {
  const t = useTheme();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]} onPress={onClose} />
      <View style={[styles.panel, { backgroundColor: t.bg }]}>
        <Text style={[styles.brand, { color: t.text }]}>Edji.</Text>
        {destinations.map((d, i) => (
          <View key={d.key}>
            {i === dividerAt && <View style={[styles.divider, { backgroundColor: t.line }]} />}
            <Pressable onPress={() => onSelect(d.key)} style={[styles.item, d.key === activeKey && { backgroundColor: t.surface }]}>
              <Text style={[styles.itemText, { color: d.key === activeKey ? t.accent : t.text }]}>{d.title}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '78%', maxWidth: 320, paddingTop: 56, paddingHorizontal: 12 },
  brand: { fontSize: 32, fontWeight: '900', paddingHorizontal: 12, marginBottom: 20 },
  item: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  itemText: { fontSize: 17, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10, marginHorizontal: 12 },
});
