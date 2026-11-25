import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { EdjiAssistant } from '../../modules/edji-assistant';
import { getDb, setPluginEnabled } from '../core/db';
import type { Plugin } from '../core/plugin';
import { isEnabled, type PluginStates } from '../core/registry';
import { loadModelSettings, saveApiKey, saveModel } from '../core/settings';
import { useTheme } from './theme';

type Props = { plugins: Plugin[]; states: PluginStates; onStatesChanged(): void };

/** Model provider (key and model), assistant setup (mic, default assistant, side button) and plugin switches. */
export function SettingsView({ plugins, states, onStatesChanged }: Props) {
  const t = useTheme();
  const [mic, setMic] = useState<boolean | null>(null);
  const [assistant, setAssistant] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'android') {
      setMic(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO));
    }
    setAssistant(EdjiAssistant?.isAssistant() ?? null);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const toggle = async (p: Plugin, value: boolean) => {
    await setPluginEnabled(await getDb(), p.id, value);
    onStatesChanged();
  };

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <ModelSection />

      <Text style={[styles.section, { color: t.muted }]}>Botão lateral</Text>
      <View style={[styles.card, { backgroundColor: t.surface }]}>
        <StatusRow
          label="Microfone"
          ok={mic}
          action="Permitir"
          onPress={async () => {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
            refresh();
          }}
        />
        <StatusRow
          label="Assistente digital padrão"
          ok={assistant}
          action="Configurar"
          onPress={() => EdjiAssistant?.openAssistantSettings()}
        />
        <Text style={[styles.hint, { color: t.muted }]}>
          No Galaxy: Configurações → Recursos avançados → Botão lateral → Pressionar e manter → Assistente digital. O menu
          de desligar passa a ficar no painel rápido.
        </Text>
      </View>

      {plugins.length > 0 && (
        <>
          <Text style={[styles.section, { color: t.muted }]}>Plugins</Text>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            {plugins.map((p) => (
              <View key={p.id} style={styles.pluginRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: t.text }]}>{p.name}</Text>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    {[p.view && 'tela', p.tools?.length && `${p.tools.length} tools`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Switch
                  value={isEnabled(p, states)}
                  onValueChange={(v) => toggle(p, v)}
                  trackColor={{ true: t.accent }}
                  accessibilityLabel={`Ligar ${p.name}`}
                />
              </View>
            ))}
            <Text style={[styles.hint, { color: t.muted }]}>Desligar um plugin esconde a tela e os comandos. Os dados ficam.</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/**
 * OpenRouter key and model. Filling in the key is the opt-in to the network:
 * without it, nothing leaves the phone. Each field saves shortly after typing
 * stops, when it loses focus, and when the screen goes away.
 */
function ModelSection() {
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

function StatusRow({ label, ok, action, onPress }: { label: string; ok: boolean | null; action: string; onPress(): void }) {
  const t = useTheme();
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.label, { color: t.text, flex: 1 }]}>
        {ok ? '✓ ' : '• '}
        {label}
      </Text>
      {ok === false && (
        <Pressable onPress={onPress} style={[styles.button, { borderColor: t.accent }]}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  card: { borderRadius: 18, padding: 16, gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  pluginRow: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 16 },
  meta: { fontSize: 13, marginTop: 2 },
  hint: { fontSize: 13, lineHeight: 19 },
  button: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: '500' },
  input: { borderWidth: 1.5, borderRadius: 12, minHeight: 48, paddingHorizontal: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  inputText: { flex: 1, fontSize: 16, paddingVertical: 10 },
  inputSolo: { fontSize: 16, paddingVertical: 10 },
  inputAction: { paddingHorizontal: 10, paddingVertical: 8 },
  divider: { height: StyleSheet.hairlineWidth },
});
