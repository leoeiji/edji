import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getDb, loadPluginStates } from './src/core/db';
import type { PluginContext } from './src/core/plugin';
import { enabledPlugins, type PluginStates } from './src/core/registry';
import { contextFor, ensureReady } from './src/core/runtime';
import { PLUGINS } from './src/plugins';
import { LogView } from './src/ui/LogView';
import { SettingsView } from './src/ui/SettingsView';
import { useTheme } from './src/ui/theme';

/** Side-panel destinations: home, enabled plugin views, then the fixed screens. */
type Destination = { key: string; title: string };

const HOME: Destination = { key: 'home', title: 'Início' };

const FIXED: Destination[] = [
  { key: 'settings', title: 'Configurações' },
  { key: 'log', title: 'Registro' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const t = useTheme();
  const [states, setStates] = useState<PluginStates | null>(null);
  const [contexts, setContexts] = useState<Record<string, PluginContext>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const reloadStates = useCallback(async () => {
    setStates(await loadPluginStates(await getDb()));
  }, []);

  useEffect(() => {
    (async () => {
      await ensureReady();
      const entries = await Promise.all(PLUGINS.map(async (p) => [p.id, await contextFor(p.id)] as const));
      setContexts(Object.fromEntries(entries));
      await reloadStates();
    })();
    // The voice session opens edji://settings when the key or the model is missing.
    const open = (url: string | null | undefined) => {
      if (url && /^edji:\/\/settings\b/.test(url)) setCurrent('settings');
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [reloadStates]);

  const views = useMemo(() => (states ? enabledPlugins(PLUGINS, states).filter((p) => p.view) : []), [states]);
  const destinations: Destination[] = [HOME, ...views.map((p) => ({ key: p.id, title: p.view!.title })), ...FIXED];
  const active = destinations.find((d) => d.key === current) ?? destinations[0];

  const body = () => {
    if (!states) return null;
    if (active.key === 'home') return null; // empty for now: the assistant lives in the voice session
    if (active.key === 'settings') return <SettingsView plugins={PLUGINS} states={states} onStatesChanged={reloadStates} />;
    if (active.key === 'log') return <LogView />;
    const plugin = views.find((p) => p.id === active.key);
    const ctx = contexts[active.key];
    if (!plugin?.view || !ctx) return null;
    const View_ = plugin.view.Component;
    return <View_ ctx={ctx} />;
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Pressable accessibilityLabel="Abrir menu" hitSlop={12} onPress={() => setPanelOpen(true)} style={styles.menu}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.menuBar, { backgroundColor: t.text }]} />
          ))}
        </Pressable>
        <Text style={[styles.title, { color: t.text }]}>{active.key === 'home' ? 'Edji.' : active.title}</Text>
      </View>

      <View style={{ flex: 1 }}>{body()}</View>

      {panelOpen && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={() => setPanelOpen(false)} />
          <View style={[styles.panel, { backgroundColor: t.bg }]}>
            <Text style={[styles.brand, { color: t.text }]}>Edji.</Text>
            {destinations.map((d, i) => (
              <View key={d.key}>
                {i === views.length + 1 && <View style={[styles.divider, { backgroundColor: t.line }]} />}
                <Pressable
                  onPress={() => {
                    setCurrent(d.key);
                    setPanelOpen(false);
                  }}
                  style={[styles.item, d.key === active.key && { backgroundColor: t.surface }]}
                >
                  <Text style={[styles.itemText, { color: d.key === active.key ? t.accent : t.text }]}>{d.title}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  menu: { gap: 4, paddingVertical: 4 },
  menuBar: { width: 20, height: 2.5, borderRadius: 2 },
  title: { fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  scrim: { backgroundColor: 'rgba(7, 20, 14, 0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '78%', maxWidth: 320, paddingTop: 56, paddingHorizontal: 12 },
  brand: { fontSize: 32, fontWeight: '900', paddingHorizontal: 12, marginBottom: 20 },
  item: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  itemText: { fontSize: 17, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10, marginHorizontal: 12 },
});
