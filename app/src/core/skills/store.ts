import type { SQLiteDatabase } from 'expo-sqlite';
import { emitChanged } from '../events';
import type { Migration } from '../plugin';
import { MAX_SKILL_INSTRUCTIONS, MAX_SKILL_NAME, MAX_SKILL_WHEN, MAX_USER_SKILLS, type Skill } from './types';

/** Schema id of the skills table in `plugin_schema`; the `_` keeps it apart from plugin ids. */
export const SKILLS_SCHEMA_ID = '_skills';

/** Topic of `onChanged` when a user skill is created, changed, deleted or loaded. */
export const SKILLS_TOPIC = '_skills';

/** The user's own skills (ADR 0010), on the phone only. System and plugin skills live in code. */
export const SKILLS_MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE user_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        when_to_use TEXT NOT NULL,
        instructions TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        load_count INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
];

export type SkillInput = { name: string; when: string; instructions: string };

type Row = {
  id: string;
  name: string;
  when_to_use: string;
  instructions: string;
  enabled: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  load_count: number;
};

function toSkill(r: Row): Skill {
  return {
    id: r.id,
    name: r.name,
    when: r.when_to_use,
    instructions: r.instructions,
    origin: { kind: 'user' },
    enabled: r.enabled === 1,
    editable: true,
    createdBy: r.created_by === 'agent' ? 'agent' : 'user',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    loadCount: r.load_count,
  };
}

/** `Resumo da semana` → `resumo_da_semana`: lowercase, no accents, letters and digits only. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return slug || 'skill';
}

/** A short Portuguese reason the input is not acceptable, or null. Trims nothing: callers pass [cleanInput] first. */
export function validateSkillInput(input: SkillInput): string | null {
  if (!input.name) return 'A skill precisa de um nome.';
  if (input.name.length > MAX_SKILL_NAME) return `O nome passa de ${MAX_SKILL_NAME} letras.`;
  if (!input.when) return 'Diga quando usar a skill, em uma frase.';
  if (input.when.length > MAX_SKILL_WHEN) return `O "quando usar" passa de ${MAX_SKILL_WHEN} letras. Deixe só o momento do pedido.`;
  if (!input.instructions) return 'A skill precisa de instruções.';
  if (input.instructions.length > MAX_SKILL_INSTRUCTIONS) return `As instruções passam de ${MAX_SKILL_INSTRUCTIONS} letras. Deixe só o essencial.`;
  return null;
}

/** Trims the fields and collapses the one-line ones (name, when) so they read well in the catalog. */
export function cleanInput(input: { name?: unknown; when?: unknown; instructions?: unknown }): SkillInput {
  const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  return { name: oneLine(input.name), when: oneLine(input.when), instructions: typeof input.instructions === 'string' ? input.instructions.trim() : '' };
}

export async function listUserSkills(db: SQLiteDatabase): Promise<Skill[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM user_skills ORDER BY created_at, id');
  return rows.map(toSkill);
}

export async function getUserSkill(db: SQLiteDatabase, id: string): Promise<Skill | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM user_skills WHERE id = ?', id);
  return row ? toSkill(row) : null;
}

export type SaveResult = { ok: true; skill: Skill } | { ok: false; reason: string };

/** Creates a user skill with a unique `user.<slug>` id. Enforces the limits. */
export async function createUserSkill(
  db: SQLiteDatabase,
  raw: { name?: unknown; when?: unknown; instructions?: unknown },
  createdBy: 'user' | 'agent',
  now = Date.now(),
): Promise<SaveResult> {
  const input = cleanInput(raw);
  const invalid = validateSkillInput(input);
  if (invalid) return { ok: false, reason: invalid };
  const count = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM user_skills'))?.n ?? 0;
  if (count >= MAX_USER_SKILLS) return { ok: false, reason: `Já são ${MAX_USER_SKILLS} skills. Apague alguma antes de criar outra.` };
  const base = `user.${slugify(input.name)}`;
  let id = base;
  for (let n = 2; await getUserSkill(db, id); n++) id = `${base}_${n}`;
  await db.runAsync(
    'INSERT INTO user_skills (id, name, when_to_use, instructions, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    id,
    input.name,
    input.when,
    input.instructions,
    createdBy,
    now,
    now,
  );
  emitChanged(SKILLS_TOPIC);
  return { ok: true, skill: (await getUserSkill(db, id))! };
}

export type SkillPatch = { name?: unknown; when?: unknown; instructions?: unknown; enabled?: boolean };

/** Changes the given fields of a user skill. A missing id is `Não achei...`; the id never changes. */
export async function updateUserSkill(db: SQLiteDatabase, id: string, patch: SkillPatch, now = Date.now()): Promise<SaveResult> {
  const current = await getUserSkill(db, id);
  if (!current) return { ok: false, reason: `Não achei a skill ${id}.` };
  const input = cleanInput({
    name: patch.name ?? current.name,
    when: patch.when ?? current.when,
    instructions: patch.instructions ?? current.instructions,
  });
  const invalid = validateSkillInput(input);
  if (invalid) return { ok: false, reason: invalid };
  const enabled = patch.enabled ?? current.enabled;
  await db.runAsync(
    'UPDATE user_skills SET name = ?, when_to_use = ?, instructions = ?, enabled = ?, updated_at = ? WHERE id = ?',
    input.name,
    input.when,
    input.instructions,
    enabled ? 1 : 0,
    now,
    id,
  );
  emitChanged(SKILLS_TOPIC);
  return { ok: true, skill: (await getUserSkill(db, id))! };
}

/** Returns false when there was no such skill. */
export async function deleteUserSkill(db: SQLiteDatabase, id: string): Promise<boolean> {
  const r = await db.runAsync('DELETE FROM user_skills WHERE id = ?', id);
  if (r.changes > 0) emitChanged(SKILLS_TOPIC);
  return r.changes > 0;
}

/** Counts a `skills__load` of a user skill, for the detail screen. */
export async function bumpLoadCount(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE user_skills SET load_count = load_count + 1 WHERE id = ?', id);
  emitChanged(SKILLS_TOPIC);
}
