import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { loadModelSettings, saveApiKey, saveModel } from '@/agent/settings';
import { useTheme } from '@/theme';
import { settingsStyles as styles } from './styles';

/**
 * OpenRouter key and model. Filling in the key is the opt-in to the network:
 * without it, nothing leaves the phone. Each field saves shortly after typing
 * stops, when it loses focus, and when the screen goes away.
 */
export function ModelSettings() {
  const t = useTheme();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    loadModelSettings().then((s) => {
      setApiKey(s.apiKey ?? '');
      setModel(s.model ?? '');
    });
  }, []);

  // Unsaved edits per field; flushed on a timer, on blur and on unmount.
  const pending = useRef<{ key?: string; model?: string }>({});
  const timers = useRef<{ key?: ReturnType<typeof setTimeout>; model?: ReturnType<typeof setTimeout> }>({});

  const persist = (what: 'key' | 'model', value: string) => (what === 'key' ? saveApiKey(value) : saveModel(value));

  const flush = async (what: 'key' | 'model') => {
    clearTimeout(timers.current[what]);
    const value = pending.current[what];
    if (value === undefined) return;
    delete pending.current[what];
    await persist(what, value);
    setSaved(what === 'key' ? (value.trim() ? 'Chave salva.' : 'Chave apagada.') : 'Modelo salvo.');
  };

  const edit = (what: 'key' | 'model', value: string) => {
    (what === 'key' ? setApiKey : setModel)(value);
    setSaved(null);
    pending.current[what] = value;
    clearTimeout(timers.current[what]);
    timers.current[what] = setTimeout(() => flush(what), 600);
  };

  useEffect(
    () => () => {
      // Leaving the screen (e.g. through the side panel) must not lose a pasted key.
      for (const what of ['key', 'model'] as const) {
        clearTimeout(timers.current[what]);
        const value = pending.current[what];
        if (value !== undefined) persist(what, value);
      }
    },
    [],
  );

  const input = [styles.input, { color: t.text, backgroundColor: t.bg, borderColor: t.line }];

  return (
    <>
      <Text style={[styles.section, { color: t.muted }]}>Modelo</Text>
      <View style={[styles.card, { backgroundColor: t.surface, gap: 16 }]}>
        <View style={styles.statusRow}>
          <Text style={[styles.label, { color: t.text, flex: 1 }]}>Provedor</Text>
          <Text style={[styles.label, { color: t.accent, fontWeight: '700' }]}>OpenRouter</Text>
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: t.text }]} nativeID="apiKeyLabel">
            Chave de API
          </Text>
          <View style={[...input, styles.inputRow]}>
            <TextInput
              accessibilityLabelledBy="apiKeyLabel"
              value={apiKey}
              onChangeText={(v) => edit('key', v)}
              onEndEditing={() => flush('key')}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="sk-or-..."
              placeholderTextColor={t.muted}
              style={[styles.inputText, { color: t.text }]}
            />
            <Pressable onPress={() => setShowKey((v) => !v)} hitSlop={8} style={styles.inputAction}>
              <Text style={{ color: t.accent, fontWeight: '700' }}>{showKey ? 'Ocultar' : 'Mostrar'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: t.text }]} nativeID="modelLabel">
            Modelo
          </Text>
          <TextInput
            accessibilityLabelledBy="modelLabel"
            value={model}
            onChangeText={(v) => edit('model', v)}
            onEndEditing={() => flush('model')}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="autor/modelo"
            placeholderTextColor={t.muted}
            style={[...input, styles.inputSolo]}
          />
          <Text style={[styles.hint, { color: t.muted }]}>Use o ID do modelo como aparece no OpenRouter.</Text>
        </View>

        {saved && <Text style={[styles.hint, { color: t.accent, fontWeight: '700' }]}>{saved}</Text>}
        <View style={[styles.divider, { backgroundColor: t.line }]} />
        <Text style={[styles.hint, { color: t.muted }]}>
          O que você fala é transcrito no aparelho. Só o texto vai para o OpenRouter, e só depois que você coloca a
          chave. A chave fica guardada neste celular.
        </Text>
      </View>
    </>
  );
}

