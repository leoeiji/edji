import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { EdjiAssistant } from '../../modules/edji-assistant';
import { ModelSettings } from '@/components/settings/ModelSettings';
import { StatusRow } from '@/components/settings/StatusRow';
import { settingsStyles as styles } from '@/components/settings/styles';
import { getDb, setPluginEnabled } from '@/core/db';
import type { Plugin } from '@/core/plugin';
import { isEnabled, type PluginStates } from '@/core/registry';
import { useTheme } from '@/theme';

type Props = { plugins: Plugin[]; states: PluginStates; onStatesChanged(): void };

/** Model provider (key and model), assistant setup (mic, default assistant, side button) and plugin switches. */
export function SettingsScreen({ plugins, states, onStatesChanged }: Props) {
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
      <ModelSettings />

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
