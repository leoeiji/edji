import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { deleteAllConversations, SAVE_VOICE_SETTING, savesVoiceConversations, setSetting } from '@/core/chatStore';
import { getDb } from '@/core/db';
import { ensureReady } from '@/core/runtime';
import { useTheme } from '@/theme';
import { settingsStyles as styles } from './styles';

/** Whether voice sessions are saved, and erasing every conversation (with an in-place confirmation). */
export function ConversationSettings() {
  const t = useTheme();
  const [saveVoice, setSaveVoice] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await ensureReady();
      setSaveVoice(await savesVoiceConversations(await getDb()));
    })();
  }, []);

  const toggle = async (value: boolean) => {
    setSaveVoice(value);
    await setSetting(await getDb(), SAVE_VOICE_SETTING, value ? '1' : '0');
  };

  const eraseAll = async () => {
    await deleteAllConversations(await getDb());
    setConfirming(false);
    setDone('Conversas apagadas.');
  };

  return (
    <>
      <Text style={[styles.section, { color: t.muted }]}>Conversas</Text>
      <View style={[styles.card, { backgroundColor: t.surface }]}>
        <View style={styles.pluginRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: t.text }]}>Guardar conversas por voz</Text>
            <Text style={[styles.meta, { color: t.muted }]}>Desligado, fechar a sessão de voz apaga a conversa.</Text>
          </View>
          <Switch
            value={saveVoice ?? true}
            disabled={saveVoice === null}
            onValueChange={toggle}
            trackColor={{ true: t.accent }}
            accessibilityLabel="Guardar conversas por voz"
          />
        </View>
        <View style={[styles.divider, { backgroundColor: t.line }]} />
        {confirming ? (
          <View style={{ gap: 10 }}>
            <Text style={[styles.hint, { color: t.text }]}>Apagar todas as conversas deste celular? Não dá para desfazer.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setConfirming(false)} accessibilityRole="button" style={[styles.button, { borderColor: t.line }]}>
                <Text style={{ color: t.text, fontWeight: '700' }}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={eraseAll} accessibilityRole="button" style={[styles.button, { borderColor: t.danger }]}>
                <Text style={{ color: t.danger, fontWeight: '700' }}>Apagar tudo</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Text style={[styles.label, { color: t.text, flex: 1 }]}>Apagar todas as conversas</Text>
            <Pressable
              onPress={() => {
                setDone(null);
                setConfirming(true);
              }}
              accessibilityRole="button"
              style={[styles.button, { borderColor: t.danger }]}
            >
              <Text style={{ color: t.danger, fontWeight: '700' }}>Apagar</Text>
            </Pressable>
          </View>
        )}
        {done && <Text style={[styles.hint, { color: t.accent, fontWeight: '700' }]}>{done}</Text>}
        <Text style={[styles.hint, { color: t.muted }]}>As conversas ficam só neste celular.</Text>
      </View>
    </>
  );
}
