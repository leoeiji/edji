import type { PluginContext, Tool, ToolResult } from './plugin';

/**
 * Tool that receives the whole transcript in the MVP. Choosing a tool from the
 * phrase (rules or a local model) comes after the MVP (ADR 0003).
 */
export const DEFAULT_VOICE_TOOL = 'todo.add';

/** Runs a voice command: in the MVP, the whole text goes to the default tool. */
export async function handleVoiceCommand(
  text: string,
  tools: Tool<any>[],
  contextFor: (pluginId: string) => Promise<PluginContext>,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === DEFAULT_VOICE_TOOL);
  if (!tool) {
    return { ok: false, reply: 'Nenhum plugin ligado recebe comandos de voz.' };
  }
  try {
    return await tool.run({ text }, await contextFor(pluginIdOf(tool.name)));
  } catch (e) {
    return { ok: false, reply: `Falha em ${tool.name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** `todo.add` → `todo`. */
export function pluginIdOf(toolName: string): string {
  return toolName.split('.')[0];
}
