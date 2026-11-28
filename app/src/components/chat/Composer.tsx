import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Attachment } from '@/agent/attachments';
import type { AttachmentsState } from '@/hooks/useAttachments';
import { useTheme } from '@/theme';
import { AttachSheet } from './AttachSheet';
import { AttachmentStrip } from './AttachmentStrip';

type Props = {
  busy: boolean;
  attachments: AttachmentsState;
  onSend(text: string, attachments: Attachment[]): void;
  onStop(): void;
  onOpenSettings(): void;
};

/**
 * Text box with attach and send; send turns into stop while a reply streams.
 * Files wait above the box until sent (ADR 0009). No microphone here.
 */
export function Composer({ busy, attachments, onSend, onStop, onOpenSettings }: Props) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const { items, error, blockedModel } = attachments;
  const canSend = (text.trim().length > 0 || items.length > 0) && !busy && !blockedModel;

  const send = () => {
    if (!canSend) return;
    onSend(text, attachments.take());
    setText('');
  };

  return (
    <View style={[styles.bar, { borderTopColor: t.line, backgroundColor: t.bg }]}>
      {items.length > 0 && <AttachmentStrip items={items} onRemove={attachments.remove} />}
      {items.length > 0 && !blockedModel && (
        <Text style={[styles.note, { color: t.muted }]}>Os anexos vão ao OpenRouter junto com a mensagem. Ficam guardados só neste aparelho.</Text>
      )}
      {blockedModel && (
        <View style={[styles.warn, { backgroundColor: t.dangerBg }]}>
          <Text style={[styles.warnText, { color: t.text }]}>
            O modelo <Text style={styles.bold}>{blockedModel}</Text> não lê imagens. Troque de modelo ou tire a imagem da mensagem.
          </Text>
          <Pressable onPress={onOpenSettings} accessibilityRole="button" style={[styles.warnButton, { borderColor: t.accent }]}>
            <Text style={{ color: t.accent, fontWeight: '700' }}>Abrir configurações</Text>
          </Pressable>
        </View>
      )}
      {error && (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: t.danger }]}>
          {error}
        </Text>
      )}
      <View style={styles.row}>
        <Pressable
          onPress={() => setMenu(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Anexar"
          style={[styles.action, { backgroundColor: t.surface, opacity: busy ? 0.4 : 1 }]}
        >
          <Text style={[styles.plus, { color: t.accent }]}>+</Text>
        </Pressable>
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
      {menu && (
        <AttachSheet onCamera={attachments.takePhoto} onGallery={attachments.pickImages} onFile={attachments.pickFiles} onClose={() => setMenu(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  action: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 26, fontWeight: '700', marginTop: -2 },
  arrow: { fontSize: 22, fontWeight: '900', marginTop: -2 },
  stop: { width: 14, height: 14, borderRadius: 3 },
  note: { fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
  error: { fontSize: 13, lineHeight: 18, paddingHorizontal: 2 },
  warn: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  warnText: { fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '700' },
  warnButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16 },
});
