/** Where a skill comes from. Only `user` skills can be changed (ADR 0010). */
export type SkillOrigin = { kind: 'system' } | { kind: 'plugin'; pluginId: string; pluginName: string } | { kind: 'user' };

/**
 * A block of instructions the agent loads on demand. `when` is the one
 * line the model sees in the catalog; `instructions` come back only when it
 * calls `skills__load`.
 */
export type Skill = {
  /** `<origin>.<slug>`: `system.write_skill`, `finance.analyze`, `user.resumo_da_semana`. */
  id: string;
  name: string;
  when: string;
  instructions: string;
  origin: SkillOrigin;
  /** In the catalog: the skill's own switch (user) or its plugin being on (plugin). System skills are always on. */
  enabled: boolean;
  /** Only the user's own skills. */
  editable: boolean;
  /** Set for the user's own skills. */
  createdBy?: 'user' | 'agent';
  createdAt?: number;
  updatedAt?: number;
  loadCount?: number;
};

/** What a plugin declares in `Plugin.skills`; the core prefixes the id with the plugin id. */
export type PluginSkill = { id: string; name: string; when: string; instructions: string };

/** Limits keep a skill cheap in the prompt and limit what injected text can store. */
export const MAX_SKILL_NAME = 60;
export const MAX_SKILL_WHEN = 200;
export const MAX_SKILL_INSTRUCTIONS = 4000;
export const MAX_USER_SKILLS = 50;

/** Plugin ids that would collide with skill origins or the core's `skills` tools. */
export const RESERVED_PLUGIN_IDS = ['skills', 'system', 'user'];

/** Short names of the core's skill tools, for the chat card ("Skills · Ler skill"). */
export const SKILL_TOOL_LABELS: Record<string, string> = {
  'skills.load': 'Ler skill',
  'skills.create': 'Criar skill',
  'skills.update': 'Alterar skill',
  'skills.delete': 'Apagar skill',
};

/** Name shown for a skill tool call; `null` for any other tool. */
export function skillToolLabel(toolName: string): string | null {
  const label = SKILL_TOOL_LABELS[toolName];
  return label ? `Skills · ${label}` : null;
}

/** Name to show for the skill [id]: from the [known] skills, else the id without its origin (a deleted skill). */
export function skillDisplayName(id: string, known: Pick<Skill, 'id' | 'name'>[]): string {
  return known.find((s) => s.id === id)?.name ?? id.slice(id.indexOf('.') + 1);
}
