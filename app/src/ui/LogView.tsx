import { useEffect, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text } from 'react-native';
import { EdjiAssistant } from '../../modules/edji-assistant';
import { useTheme } from './theme';

/** Diagnostic log of the voice path (latencies, recognizer, inbox), newest first. */
export function LogView() {
  const t = useTheme();
  const [lines, setLines] = useState<string[]>(() => EdjiAssistant?.logLines().slice().reverse() ?? []);

  useEffect(() => {
    if (!EdjiAssistant) return;
    const sub = EdjiAssistant.addListener('onLog', ({ line }) => setLines((prev) => [line, ...prev].slice(0, 150)));
    return () => sub.remove();
  }, []);

  return (
    <FlatList
      data={lines}
      keyExtractor={(l, i) => `${i}-${l}`}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
      ListEmptyComponent={<Text style={{ color: t.muted }}>Nada registrado ainda. Segure o botão lateral.</Text>}
      renderItem={({ item }) => <Text style={[styles.line, { color: t.text }]}>{item}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: Platform.select({ android: 'monospace', default: 'Courier' }), fontSize: 12, lineHeight: 18, marginBottom: 6 },
});
