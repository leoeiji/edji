import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

type Props =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'error'; text: string; onSettings?: () => void }
  | { kind: 'thinking' }
  | { kind: 'stopped' };

/**
 * A chat message: the user's in a bubble (pine, right); the reply as plain
 * text across the whole width, with no bubble; an error; or a short state line.
 */
export function MessageBubble(props: Props) {
  const t = useTheme();
  if (props.kind === 'thinking' || props.kind === 'stopped') {
    return <Text style={[styles.note, { color: t.muted }]}>{props.kind === 'thinking' ? 'Pensando…' : 'Interrompida.'}</Text>;
  }
  if (props.kind === 'error') {
    return (
      <View style={[styles.bubble, styles.left, { backgroundColor: t.dangerBg }]}>
        <Text selectable style={[styles.text, { color: t.text }]}>
          {props.text}
        </Text>
        {props.onSettings && (
          <Pressable onPress={props.onSettings} accessibilityRole="button" style={[styles.button, { borderColor: t.accent }]}>
            <Text style={{ color: t.accent, fontWeight: '700' }}>Abrir configurações</Text>
          </Pressable>
        )}
      </View>
    );
  }
  if (props.kind === 'text') {
    return (
      <Text selectable style={[styles.reply, { color: t.text }]}>
        {props.text}
      </Text>
    );
  }
  return (
    <View style={[styles.bubble, styles.right, { backgroundColor: t.userBubble }]}>
      <Text selectable style={[styles.text, { color: t.onUserBubble }]}>
        {props.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  left: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  right: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  text: { fontSize: 16, lineHeight: 23 },
  reply: { fontSize: 16, lineHeight: 24, paddingHorizontal: 2, paddingVertical: 2 },
  note: { fontSize: 14, paddingHorizontal: 4 },
  button: { alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
});
