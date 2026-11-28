import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { loadModelSettings, saveApiKey, saveLightModel, saveModel } from '@/agent/settings';
import { useTheme } from '@/theme';
import { settingsStyles as styles } from './styles';

type Field = 'key' | 'model' | 'light';

const FIELDS: Field[] = ['key', 'model', 'light'];

const SAVE: Record<Field, (value: string) => Promise<void>> = { key: saveApiKey, model: saveModel, light: saveLightModel };

function savedMessage(field: Field, value: string): string {
  if (field === 'key') return value.trim() ? 'Chave salva.' : 'Chave apagada.';
  if (field === 'model') return 'Modelo salvo.';
  return value.trim() ? 'Modelo leve salvo.' : 'Modelo leve apagado.';
}

/**
 * OpenRouter key, conversation model and light model. Filling in the key is
 * the opt-in to the network: without it, nothing leaves the phone. Each field
 * saves shortly after typing stops, when it loses focus, and when the screen
 * goes away.
 */
export function ModelSettings() {
  const t = useTheme();
  const [values, setValues] = useState<Record<Field, string>>({ key: '', model: '', light: '' });
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    loadModelSettings().then((s) => setValues({ key: s.apiKey ?? '', model: s.model ?? '', light: s.lightModel ?? '' }));
  }, []);

  // Unsaved edits per field; flushed on a timer, on blur and on unmount.
  const pending = useRef<Partial<Record<Field, string>>>({});
  const timers = useRef<Partial<Record<Field, ReturnType<typeof setTimeout>>>>({});

  const flush = async (field: Field) => {
    clearTimeout(timers.current[field]);
    const value = pending.current[field];
    if (value === undefined) return;
    delete pending.current[field];
    await SAVE[field](value);
    setSaved(savedMessage(field, value));
  };

  const edit = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setSaved(null);
    pending.current[field] = value;
    clearTimeout(timers.current[field]);
    timers.current[field] = setTimeout(() => flush(field), 600);
  };

  useEffect(
    () => () => {
      // Leaving the screen (e.g. through the side panel) must not lose a pasted key.
      for (const field of FIELDS) {
        clearTimeout(timers.current[field]);
        const value = pending.current[field];
        if (value !== undefined) SAVE[field](value);
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
              value={values.key}
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
            value={values.model}
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

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: t.text }]} nativeID="lightModelLabel">
            Modelo leve
          </Text>
          <TextInput
            accessibilityLabelledBy="lightModelLabel"
            value={values.light}
            onChangeText={(v) => edit('light', v)}
            onEndEditing={() => flush('light')}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="autor/modelo-pequeno"
            placeholderTextColor={t.muted}
            style={[...input, styles.inputSolo]}
          />
          <Text style={[styles.hint, { color: t.muted }]}>
            Para tarefas rápidas fora da conversa. Hoje: dar título às conversas. Vazio, o título são as primeiras
            palavras do pedido.
          </Text>
        </View>

        {saved && <Text style={[styles.hint, { color: t.accent, fontWeight: '700' }]}>{saved}</Text>}
        <View style={[styles.divider, { backgroundColor: t.line }]} />
        <Text style={[styles.hint, { color: t.muted }]}>
          O que você fala é transcrito no aparelho. Só o texto vai para o OpenRouter, e só depois que você coloca a
          chave. O modelo leve recebe só o primeiro pedido e a primeira resposta de cada conversa. A chave fica
          guardada neste celular.
        </Text>
      </View>
    </>
  );
}

