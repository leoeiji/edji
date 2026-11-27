import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/theme';

type Props = { busy: boolean; onSend(text: string): void; onStop(): void };

/** Text box with send, which turns into stop while a reply streams. No attachments or microphone yet. */
export function Composer({ busy, onSend, onStop }: Props) {
  const t = useTheme();
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !busy;

  const send = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={[styles.bar, { borderTopColor: t.line, backgroundColor: t.bg }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Mensagem"
        placeholderTextColor={t.muted}
        multiline
        accessibilityLabel="Mensagem para o Edji"
        style={[styles.input, { color: t.text, backgroundColor: t.surface }]}
      />
      {busy ? (
        <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="Parar resposta" style={[styles.action, { backgroundColor: t.heroBg }]}>
          <View style={[styles.stop, { backgroundColor: t.heroHi }]} />
        </Pressable>
      ) : (
        <Pressable
          onPress={send}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Enviar"
          accessibilityState={{ disabled: !canSend }}
          style={[styles.action, { backgroundColor: t.heroBg, opacity: canSend ? 1 : 0.4 }]}
        >
          <Text style={[styles.arrow, { color: t.heroHi }]}>↑</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  action: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 22, fontWeight: '900', marginTop: -2 },
  stop: { width: 14, height: 14, borderRadius: 3 },
});
