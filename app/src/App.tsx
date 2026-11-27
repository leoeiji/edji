import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { SidePanel } from '@/components/SidePanel';
import { deleteConversation, findVoiceConversation, renameConversation } from '@/core/chatStore';
import { getDb } from '@/core/db';
import { ensureReady } from '@/core/runtime';
import { useConversations } from '@/hooks/useConversations';
import { useDeepLink } from '@/hooks/useDeepLink';
import { usePlugins } from '@/hooks/usePlugins';
import type { DeepLink } from '@/navigation/deepLink';
import { destinationsFor, HOME } from '@/navigation/destinations';
import { ChatScreen } from '@/screens/ChatScreen';
import { LogScreen } from '@/screens/LogScreen';
import { PermissionsScreen } from '@/screens/PermissionsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { useTheme } from '@/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

/** Header, current screen and side panel. Home is the chat; `conversationId` null is a new chat. */
function Shell() {
  const t = useTheme();
  const { plugins, states, contexts, views, reload } = usePlugins();
  const conversations = useConversations();
  const [current, setCurrent] = useState<string>(HOME.key);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const openConversation = useCallback((id: number | null) => {
    setCurrent(HOME.key);
    setConversationId(id);
    setPanelOpen(false);
  }, []);

  useDeepLink(
    useCallback(
      async (link: DeepLink) => {
        if (link.kind === 'screen') return setCurrent(link.screen);
        if (link.kind === 'conversation') return openConversation(link.id);
        await ensureReady();
        const found = await findVoiceConversation(await getDb(), link.sessionId);
        openConversation(found?.id ?? null);
      },
      [openConversation],
    ),
  );

  const destinations = destinationsFor(views);
  const active = destinations.find((d) => d.key === current) ?? destinations[0];
  const onChat = active.key === HOME.key;
  const conversation = conversations.find((c) => c.id === conversationId);

  const screen = () => {
    if (!states) return null;
    if (onChat) {
      return <ChatScreen conversationId={conversationId} onCreated={setConversationId} onOpenSettings={() => setCurrent('settings')} />;
    }
    if (active.key === 'settings') return <SettingsScreen plugins={plugins} states={states} onStatesChanged={reload} />;
    if (active.key === 'permissions') return <PermissionsScreen />;
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
      <Header
        title={onChat ? (conversation?.title ?? 'Edji.') : active.title}
        compact={onChat && conversation !== undefined}
        onMenu={() => setPanelOpen(true)}
        onNew={onChat && conversationId !== null ? () => openConversation(null) : undefined}
      />
      <View style={{ flex: 1 }}>{screen()}</View>
      {panelOpen && (
        <SidePanel
          conversations={conversations}
          activeConversationId={onChat ? conversationId : null}
          destinations={destinations.filter((d) => d.key !== HOME.key)}
          activeKey={onChat ? null : active.key}
          dividerAt={views.length}
          onNewConversation={() => openConversation(null)}
          onOpenConversation={openConversation}
          onRename={async (id, title) => renameConversation(await getDb(), id, title)}
          onDelete={async (id) => {
            await deleteConversation(await getDb(), id);
            if (id === conversationId) setConversationId(null);
          }}
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
