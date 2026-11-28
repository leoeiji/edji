import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getDb } from '@/core/db';
import { createUserSkill, deleteUserSkill, updateUserSkill } from '@/core/skills/store';
import type { Skill } from '@/core/skills/types';
import { SkillCard } from '@/components/skills/SkillCard';
import { SkillDetail } from '@/components/skills/SkillDetail';
import { SkillForm, type SkillDraft } from '@/components/skills/SkillForm';
import { useSkills } from '@/hooks/useSkills';
import { useTheme } from '@/theme';

type Props = {
  /** The skill open in the detail, or null for the list. Kept by the shell so "Abrir skill" can link here. */
  selectedId: string | null;
  onSelect(id: string | null): void;
};

type Filter = 'all' | 'system' | 'plugin' | 'user';
type Mode = { kind: 'view' } | { kind: 'form'; editing: string | null; draft: SkillDraft };

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'system', label: 'Sistema' },
  { key: 'plugin', label: 'Plugins' },
  { key: 'user', label: 'Minhas' },
];

const SECTIONS: { kind: Exclude<Filter, 'all'>; title: string; note: string }[] = [
  { kind: 'system', title: 'Sistema', note: 'vêm com o Edji' },
  { kind: 'plugin', title: 'Plugins', note: 'só leitura' },
  { kind: 'user', title: 'Minhas', note: 'você e o agente editam' },
];

const EMPTY_DRAFT: SkillDraft = { name: '', when: '', instructions: '', enabled: true };

/** Every skill the agent can use, by origin; open one to read it, or create and edit the user's own (ADR 0010). */
export function SkillsScreen({ selectedId, onSelect }: Props) {
  const t = useTheme();
  const { skills } = useSkills();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'view' });

  const selected = skills?.find((s) => s.id === selectedId) ?? null;
  const counts = useMemo(() => {
    const n: Record<Filter, number> = { all: 0, system: 0, plugin: 0, user: 0 };
    for (const s of skills ?? []) {
      n.all++;
      n[s.origin.kind]++;
    }
    return n;
  }, [skills]);

  const visible = (skills ?? []).filter((s) => {
    if (filter !== 'all' && s.origin.kind !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || `${s.name} ${s.when}`.toLowerCase().includes(q);
  });

  const save = async (draft: SkillDraft): Promise<string | null> => {
    const db = await getDb();
    const editing = mode.kind === 'form' ? mode.editing : null;
    const r = editing ? await updateUserSkill(db, editing, draft) : await createUserSkill(db, draft, 'user');
    if (!r.ok) return r.reason;
    if (!editing && !draft.enabled) await updateUserSkill(db, r.skill.id, { enabled: false });
    setMode({ kind: 'view' });
    onSelect(r.skill.id);
    return null;
  };

  const form = (title: string, editing: string | null, draft: SkillDraft) => (
    <SkillForm
      key={`${editing ?? 'new'}-${title}`}
      title={title}
      initial={draft}
      onCancel={() => setMode({ kind: 'view' })}
      onSave={save}
    />
  );

  const body = () => {
    if (!skills) return null;
    if (mode.kind === 'form') return form(mode.editing ? 'Editar skill' : 'Nova skill', mode.editing, mode.draft);
    if (selected) return <SkillView skill={selected} onBack={() => onSelect(null)} onEdit={setMode} />;
    if (selectedId) {
      // A skill that no longer exists (deleted, or its link is old): say so and go back to the list.
      return (
        <View style={styles.missing}>
          <Text style={[styles.missingText, { color: t.text }]}>Essa skill não existe mais.</Text>
          <Pressable onPress={() => onSelect(null)} accessibilityRole="button">
            <Text style={[styles.link, { color: t.accent }]}>Ver todas as skills</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar skill"
          placeholderTextColor={t.muted}
          accessibilityLabel="Buscar skill"
          style={[styles.search, { backgroundColor: t.surface, color: t.text }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { borderColor: on ? t.heroBg : t.line, backgroundColor: on ? t.heroBg : 'transparent' }]}
              >
                <Text style={[styles.chipText, { color: on ? t.heroText : t.muted }]}>
                  {f.label} {counts[f.key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {visible.length === 0 && <Text style={[styles.empty, { color: t.muted }]}>Nenhuma skill encontrada.</Text>}
        {SECTIONS.map((sec) => {
          const items = visible.filter((s) => s.origin.kind === sec.kind);
          if (items.length === 0) return null;
          return (
            <View key={sec.kind} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: t.muted }]}>
                {sec.title}
                <Text style={styles.sectionNote}>  {sec.note}</Text>
              </Text>
              {items.map((s) => (
                <SkillCard key={s.id} skill={s} onPress={() => onSelect(s.id)} />
              ))}
            </View>
          );
        })}
      </>
    );
  };

  const onList = !selectedId && mode.kind === 'view';
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {body()}
      </ScrollView>
      {onList && skills && (
        <Pressable
          onPress={() => setMode({ kind: 'form', editing: null, draft: EMPTY_DRAFT })}
          accessibilityRole="button"
          style={[styles.fab, { backgroundColor: t.heroBg }]}
        >
          <Text style={[styles.fabPlus, { color: t.heroHi }]}>+</Text>
          <Text style={[styles.fabText, { color: t.heroText }]}>Nova skill</Text>
        </Pressable>
      )}
    </View>
  );
}

type DetailProps = { skill: Skill; onBack(): void; onEdit(m: Mode): void };

/** The open skill: back link and [SkillDetail] wired to the store. A top-level component so the delete confirmation survives re-renders. */
function SkillView({ skill, onBack, onEdit }: DetailProps) {
  const t = useTheme();
  return (
    <View style={styles.detail}>
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={8}>
        <Text style={[styles.link, { color: t.accent }]}>‹ Todas as skills</Text>
      </Pressable>
      <SkillDetail
        skill={skill}
        onToggle={(enabled) => {
          getDb().then((db) => updateUserSkill(db, skill.id, { enabled }));
        }}
        onEdit={() =>
          onEdit({ kind: 'form', editing: skill.id, draft: { name: skill.name, when: skill.when, instructions: skill.instructions, enabled: skill.enabled } })
        }
        onDelete={async () => {
          await deleteUserSkill(await getDb(), skill.id);
          onBack();
        }}
        onCopy={() =>
          onEdit({ kind: 'form', editing: null, draft: { name: `${skill.name} (cópia)`, when: skill.when, instructions: skill.instructions, enabled: true } })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 110, gap: 10 },
  search: { borderRadius: 12, paddingHorizontal: 12, height: 40, fontSize: 15 },
  chips: { gap: 6, paddingVertical: 2 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, fontWeight: '700' },
  section: { gap: 8, marginTop: 6 },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionNote: { fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  empty: { fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, height: 48, paddingHorizontal: 18 },
  fabPlus: { fontSize: 22, fontWeight: '900', lineHeight: 24 },
  fabText: { fontSize: 15, fontWeight: '700' },
  detail: { gap: 12 },
  link: { fontSize: 15, fontWeight: '700' },
  missing: { gap: 10, paddingVertical: 24, alignItems: 'center' },
  missingText: { fontSize: 15 },
});
