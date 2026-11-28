import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ToolPart } from '@/agent/agent';
import { formatDuration } from '@/core/chatView';
import { toolLabel } from '@/core/registry';
import { PLUGINS } from '@/plugins';
import { useTheme } from '@/theme';
import { SkillReadLine } from './SkillReadLine';

type Props = { tool: ToolPart };

/**
 * A tool call in the chat. Closed: state, "Plugin · Ação" and time. Open: the
 * technical name, the input as key/value pairs and the handler's reply.
 */
export function ToolCard({ tool }: Props) {
  // Reading a skill is a quiet line, not a card, and never shows the skill's text (ADR 0010).
  if (tool.name === 'skills.load') return <SkillReadLine tool={tool} />;
  return <ToolCardBody tool={tool} />;
}

/** Skills the agent wrote or deleted: shown tinted, with a link to the skill. */
function skillWriteId(tool: ToolPart): string | null {
  if (tool.name === 'skills.create') return tool.output?.match(/user\.[a-z0-9_]+/)?.[0] ?? null;
  if (tool.name === 'skills.update') return typeof tool.input.id === 'string' ? tool.input.id : null;
  return null;
}

function ToolCardBody({ tool }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const failed = tool.state === 'failed';
  const [plugin, action] = splitLabel(toolLabel(PLUGINS, tool.name));
  const entries = Object.entries(tool.input);
  const skillId = skillWriteId(tool);

  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${plugin} ${action}, ${STATE_LABEL[tool.state]}`}
      style={[styles.card, { backgroundColor: failed ? t.dangerBg : tool.name.startsWith('skills.') ? t.skillUserBg : t.toolBg, borderColor: t.line }]}
    >
      <View style={styles.row}>
        <StateMark state={tool.state} />
        <Text style={[styles.label, { color: t.text }]} numberOfLines={1}>
          <Text style={styles.plugin}>{plugin}</Text>
          {action ? ` · ${action}` : ''}
        </Text>
        {tool.durationMs !== undefined && <Text style={[styles.time, { color: t.muted }]}>{formatDuration(tool.durationMs)}</Text>}
        <Text style={[styles.chevron, { color: t.muted }]}>{open ? '⌄' : '›'}</Text>
      </View>
      {open && (
        <View style={styles.body}>
          <Text style={[styles.raw, { color: t.muted }]}>{tool.name}</Text>
          {entries.length > 0 && (
            <View style={[styles.kv, { backgroundColor: t.bg, borderColor: t.line }]}>
              {entries.map(([k, v]) => (
                <Text key={k} style={[styles.mono, { color: t.text }]}>
                  <Text style={{ color: t.muted }}>{k} </Text>
                  {formatValue(v)}
                </Text>
              ))}
            </View>
          )}
          {tool.output !== undefined && <Text style={[styles.output, { color: t.text }]}>{tool.output}</Text>}
          {skillId && tool.state === 'done' && (
            <Pressable onPress={() => Linking.openURL(`edji://skills/${skillId}`)} accessibilityRole="link" hitSlop={8}>
              <Text style={[styles.link, { color: t.skillUser }]}>Abrir skill</Text>
            </Pressable>
          )}
          {tool.output === undefined && tool.state !== 'running' && (
            <Text style={[styles.output, { color: t.muted }]}>Interrompida antes de terminar.</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const STATE_LABEL: Record<ToolPart['state'], string> = { running: 'rodando', done: 'concluída', failed: 'falhou' };

function StateMark({ state }: { state: ToolPart['state'] }) {
  const t = useTheme();
  if (state === 'running') return <ActivityIndicator size="small" color={t.accent} style={styles.mark} />;
  const failed = state === 'failed';
  return (
    <View style={[styles.mark, styles.dot, { backgroundColor: failed ? t.danger : t.heroBg }]}>
      <Text style={[styles.dotText, { color: failed ? t.dangerBg : t.heroHi }]}>{failed ? '!' : '✓'}</Text>
    </View>
  );
}

function splitLabel(label: string): [string, string] {
  const at = label.indexOf(' · ');
  return at === -1 ? [label, ''] : [label.slice(0, at), label.slice(at + 3)];
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mark: { width: 18, height: 18 },
  dot: { borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 11, fontWeight: '900' },
  label: { flex: 1, fontSize: 14 },
  plugin: { fontWeight: '700' },
  time: { fontSize: 12, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 16, width: 14, textAlign: 'center' },
  body: { gap: 8, marginTop: 8 },
  raw: { fontFamily: 'monospace', fontSize: 12 },
  kv: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 8, gap: 2 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  output: { fontSize: 14, lineHeight: 20 },
  link: { fontSize: 13, fontWeight: '700' },
});
