import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from '@/testing/nodeSqlite';
import { applyMigrations } from '../../db';
import { onChanged } from '../../events';
import type { Plugin, PluginContext } from '../../plugin';
import { catalogText, collectSkills, listSkills } from '../catalog';
import {
  SKILLS_MIGRATIONS,
  SKILLS_SCHEMA_ID,
  SKILLS_TOPIC,
  createUserSkill,
  deleteUserSkill,
  getUserSkill,
  listUserSkills,
  slugify,
  updateUserSkill,
} from '../store';
import { skillTools } from '../tools';
import { MAX_SKILL_INSTRUCTIONS, MAX_SKILL_WHEN, MAX_USER_SKILLS, skillDisplayName } from '../types';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

const finance: Plugin = {
  id: 'finance',
  name: 'Finanças',
  version: '1',
  enabledByDefault: true,
  skills: [{ id: 'analyze', name: 'Analisar gastos', when: 'Quando pedir resumo de gastos.', instructions: 'Chame finance__summary.' }],
};

const input = { name: 'Resumo da semana', when: 'Quando eu pedir o resumo da semana.', instructions: '1. Chame finance__summary.' };

let db: SQLiteDatabase;
let ctx: PluginContext;
beforeEach(async () => {
  db = openTestDb();
  await db.execAsync(
    'CREATE TABLE plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL); CREATE TABLE plugin_state (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL)',
  );
  await applyMigrations(db, SKILLS_SCHEMA_ID, SKILLS_MIGRATIONS);
  ctx = { db, notifyChanged: () => {}, enabledTools: async () => [] };
});

describe('skillDisplayName', () => {
  it('uses the catalog name, or the id without its origin for a deleted skill', () => {
    expect(skillDisplayName('user.mercado', [{ id: 'user.mercado', name: 'Mercado' }])).toBe('Mercado');
    expect(skillDisplayName('user.resumo_antigo', [])).toBe('resumo_antigo');
  });
});

describe('slugify', () => {
  it('drops accents and punctuation', () => {
    expect(slugify('Resumo da Semana!')).toBe('resumo_da_semana');
    expect(slugify('Ação rápida — mercado')).toBe('acao_rapida_mercado');
    expect(slugify('???')).toBe('skill');
  });
});

describe('user skills store', () => {
  it('creates a skill with a slug id and a unique suffix for a repeated name', async () => {
    const a = await createUserSkill(db, input, 'user');
    const b = await createUserSkill(db, input, 'agent');
    expect(a.ok && a.skill.id).toBe('user.resumo_da_semana');
    expect(b.ok && b.skill.id).toBe('user.resumo_da_semana_2');
    expect(b.ok && b.skill.createdBy).toBe('agent');
    expect((await listUserSkills(db)).map((s) => s.id)).toEqual(['user.resumo_da_semana', 'user.resumo_da_semana_2']);
  });

  it('collapses whitespace in name and when, and keeps the instructions text', async () => {
    const r = await createUserSkill(db, { name: '  Resumo\n da   semana ', when: 'Quando\n pedir.', instructions: ' 1. a\n2. b ' }, 'user');
    expect(r.ok && [r.skill.name, r.skill.when, r.skill.instructions]).toEqual(['Resumo da semana', 'Quando pedir.', '1. a\n2. b']);
  });

  it('rejects empty and oversized fields with a reason', async () => {
    expect((await createUserSkill(db, { ...input, name: ' ' }, 'user')).ok).toBe(false);
    const when = await createUserSkill(db, { ...input, when: 'x'.repeat(MAX_SKILL_WHEN + 1) }, 'user');
    expect(!when.ok && when.reason).toContain(String(MAX_SKILL_WHEN));
    const long = await createUserSkill(db, { ...input, instructions: 'x'.repeat(MAX_SKILL_INSTRUCTIONS + 1) }, 'user');
    expect(long.ok).toBe(false);
    expect(await listUserSkills(db)).toEqual([]);
  });

  it('stops at the limit of skills', async () => {
    for (let i = 0; i < MAX_USER_SKILLS; i++) await createUserSkill(db, { ...input, name: `Skill ${i}` }, 'user');
    const r = await createUserSkill(db, { ...input, name: 'Mais uma' }, 'user');
    expect(!r.ok && r.reason).toContain('Apague');
  });

  it('updates only the given fields, keeps the id and can switch off', async () => {
    await createUserSkill(db, input, 'agent', 1000);
    const r = await updateUserSkill(db, 'user.resumo_da_semana', { when: 'Quando eu pedir o balanço.', enabled: false }, 2000);
    expect(r.ok && r.skill).toMatchObject({ id: 'user.resumo_da_semana', name: 'Resumo da semana', when: 'Quando eu pedir o balanço.', enabled: false, updatedAt: 2000, createdAt: 1000 });
    expect((await updateUserSkill(db, 'user.nada', { name: 'x' })).ok).toBe(false);
  });

  it('deletes, and tells subscribers about every change', async () => {
    const seen = jest.fn();
    const off = onChanged(SKILLS_TOPIC, seen);
    await createUserSkill(db, input, 'user');
    expect(await deleteUserSkill(db, 'user.resumo_da_semana')).toBe(true);
    expect(await deleteUserSkill(db, 'user.resumo_da_semana')).toBe(false);
    expect(await getUserSkill(db, 'user.resumo_da_semana')).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('catalog', () => {
  it('lists system, plugin and user skills in that order, read-only except the user ones', async () => {
    await createUserSkill(db, input, 'user');
    const skills = await listSkills(db, [finance]);
    expect(skills.map((s) => [s.id, s.origin.kind, s.editable])).toEqual([
      ['system.write_skill', 'system', false],
      ['finance.analyze', 'plugin', false],
      ['user.resumo_da_semana', 'user', true],
    ]);
  });

  it('leaves the skills of a disabled plugin out of the catalog but still lists them', async () => {
    await db.runAsync('INSERT INTO plugin_state (id, enabled) VALUES (?, 0)', 'finance');
    const skills = await listSkills(db, [finance]);
    expect(skills.find((s) => s.id === 'finance.analyze')?.enabled).toBe(false);
    expect(catalogText(skills)).not.toContain('finance.analyze');
    expect(catalogText(skills)).toContain('system.write_skill');
  });

  it('writes one line per enabled skill with id, name and when, and no instructions', () => {
    const skills = collectSkills([finance], {}, []);
    const text = catalogText(skills);
    expect(text).toContain('skills__load');
    expect(text).toContain('- finance.analyze: Analisar gastos. Quando pedir resumo de gastos.');
    expect(text).not.toContain('Chame finance__summary');
  });

  it('is empty when nothing is enabled', () => {
    expect(catalogText([])).toBe('');
  });
});

describe('skill tools', () => {
  const tool = (name: string) => skillTools([finance]).find((t) => t.name === name)!;

  it('loads the text of any enabled skill and counts reads of the user ones', async () => {
    await createUserSkill(db, input, 'user');
    const own = await tool('skills.load').run({ id: 'user.resumo_da_semana' }, ctx);
    expect(own).toEqual({ ok: true, reply: '# Resumo da semana\n1. Chame finance__summary.' });
    expect((await getUserSkill(db, 'user.resumo_da_semana'))?.loadCount).toBe(1);
    const plugin = await tool('skills.load').run({ id: 'finance.analyze' }, ctx);
    expect(plugin).toEqual({ ok: true, reply: '# Analisar gastos\nChame finance__summary.' });
  });

  it('answers an unknown or disabled skill with the ids that exist', async () => {
    await createUserSkill(db, input, 'user');
    await updateUserSkill(db, 'user.resumo_da_semana', { enabled: false });
    const r = await tool('skills.load').run({ id: 'user.resumo_da_semana' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.reply).toContain('system.write_skill');
    expect(r.reply).not.toContain('user.resumo_da_semana,');
  });

  it('creates, updates and deletes the user skills as the agent', async () => {
    const created = await tool('skills.create').run(input, ctx);
    expect(created).toEqual({ ok: true, reply: 'Skill criada: user.resumo_da_semana (Resumo da semana).' });
    expect((await getUserSkill(db, 'user.resumo_da_semana'))?.createdBy).toBe('agent');
    expect((await tool('skills.update').run({ id: 'user.resumo_da_semana', name: 'Balanço' }, ctx)).ok).toBe(true);
    expect((await getUserSkill(db, 'user.resumo_da_semana'))?.name).toBe('Balanço');
    expect((await tool('skills.delete').run({ id: 'user.resumo_da_semana' }, ctx)).ok).toBe(true);
    expect((await tool('skills.delete').run({ id: 'user.resumo_da_semana' }, ctx)).ok).toBe(false);
  });

  it('refuses to change or delete system and plugin skills', async () => {
    for (const id of ['system.write_skill', 'finance.analyze']) {
      const update = await tool('skills.update').run({ id, name: 'x' }, ctx);
      const remove = await tool('skills.delete').run({ id }, ctx);
      expect(update.ok).toBe(false);
      expect(update.reply).toContain('não pode ser alterada');
      expect(remove.ok).toBe(false);
    }
  });

  it('is never offered to routines: none is a routine action', () => {
    expect(skillTools([]).every((t) => !t.routineAction)).toBe(true);
    expect(skillTools([]).map((t) => t.name)).toEqual(['skills.load', 'skills.create', 'skills.update', 'skills.delete']);
  });
});
