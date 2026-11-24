import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { EdjiAssistant } from '../../modules/edji-assistant';
import { getDb, setPluginEnabled } from '../core/db';
import type { Plugin } from '../core/plugin';
import { isEnabled, type PluginStates } from '../core/registry';
import { useTheme } from './theme';

type Props = { plugins: Plugin[]; states: PluginStates; onStatesChanged(): void };

/** Assistant setup (mic, default assistant, side button) and plugin switches. */
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
    <ScrollView contentContainerStyle={styles.root}>
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
    </ScrollView>
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
});
