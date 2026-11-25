import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { SidePanel } from '@/components/SidePanel';
import { useDeepLink } from '@/hooks/useDeepLink';
import { usePlugins } from '@/hooks/usePlugins';
import { destinationsFor } from '@/navigation/destinations';
import { HomeScreen } from '@/screens/HomeScreen';
import { LogScreen } from '@/screens/LogScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { useTheme } from '@/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

/** Header, current screen and side panel. */
function Shell() {
  const t = useTheme();
  const { plugins, states, contexts, views, reload } = usePlugins();
  const [current, setCurrent] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useDeepLink(useCallback((screen: string) => setCurrent(screen), []));

  const destinations = destinationsFor(views);
  const active = destinations.find((d) => d.key === current) ?? destinations[0];

  const screen = () => {
    if (!states) return null;
    if (active.key === 'home') return <HomeScreen />;
    if (active.key === 'settings') return <SettingsScreen plugins={plugins} states={states} onStatesChanged={reload} />;
    if (active.key === 'log') return <LogScreen />;
    const plugin = views.find((p) => p.id === active.key);
    const ctx = contexts[active.key];
    if (!plugin?.view || !ctx) return null;
    const PluginView = plugin.view.Component;
    return <PluginView ctx={ctx} />;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      <Header title={active.key === 'home' ? 'Edji.' : active.title} onMenu={() => setPanelOpen(true)} />
      <View style={{ flex: 1 }}>{screen()}</View>
      {panelOpen && (
        <SidePanel
          destinations={destinations}
          activeKey={active.key}
          dividerAt={views.length + 1}
          onSelect={(key) => {
            setCurrent(key);
            setPanelOpen(false);
          }}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}
