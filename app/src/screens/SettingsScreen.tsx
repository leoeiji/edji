import { ScrollView, Switch, Text, View } from 'react-native';
import { ConversationSettings } from '@/components/settings/ConversationSettings';
import { ModelSettings } from '@/components/settings/ModelSettings';
import { RoutinesSettings } from '@/components/settings/RoutinesSettings';
import { settingsStyles as styles } from '@/components/settings/styles';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { getDb, setPluginEnabled } from '@/core/db';
import type { AppUpdate } from '@/hooks/useAppUpdate';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import type { Plugin } from '@/core/plugin';
import { isEnabled, type PluginStates } from '@/core/registry';
import { useTheme } from '@/theme';

type Props = { plugins: Plugin[]; states: PluginStates; onStatesChanged(): void; update: AppUpdate };

/** Model provider (key, model, light model), conversations, the routines opt-in, plugin switches and updates. Device permissions live in `PermissionsScreen`. */
export function SettingsScreen({ plugins, states, onStatesChanged, update }: Props) {
  const t = useTheme();
  const keyboard = useKeyboardInset();
  const toggle = async (p: Plugin, value: boolean) => {
    await setPluginEnabled(await getDb(), p.id, value);
    onStatesChanged();
  };

  return (
    <ScrollView style={{ marginBottom: keyboard }} contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <ModelSettings />
      <ConversationSettings />
      <RoutinesSettings />

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

      <UpdateSettings update={update} />
    </ScrollView>
  );
}
