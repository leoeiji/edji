import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { missingPermissions, permissionById } from '@/core/permissions';
import { useTheme } from '@/theme';
import { ACTION_CATALOG, STEP_CATALOG, TRIGGER_CATALOG, type CatalogEntry } from './catalog';
import { describeAction, describeRoutine, describeStep, describeTrigger } from './describe';
import { formatWhen, routineFooter, runLabel } from './format';
import { requiredPermissions } from './requirements';
import { MAX_ACTIONS, MAX_STEPS, type Routine } from './types';
import { useRoutines, type RoutinesData } from './useRoutines';

type Tab = 'routines' | 'actions' | 'steps' | 'triggers';

/**
 * Read-only list of routines and their details (with open failures), plus a
 * catalog of the triggers, steps and actions available. Only the agent creates or
 * changes routines for now (ADR 0005), so there are no edit controls here.
 */
export function RoutinesView() {
  const { data, reload } = useRoutines();
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('routines');

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  if (!data) return null;
  const routine = data.routines.find((r) => r.id === selected);
  return (
    <ScrollView contentContainerStyle={styles.root} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {routine ? (
        <RoutineDetail routine={routine} data={data} onBack={() => setSelected(null)} />
      ) : (
        <>
          <Tabs tab={tab} onChange={setTab} />
          {tab === 'routines' && <RoutineList data={data} onOpen={setSelected} />}
          {tab === 'triggers' && <Catalog kind="triggers" statuses={data.statuses} />}
          {tab === 'steps' && <Catalog kind="steps" statuses={data.statuses} />}
          {tab === 'actions' && <Catalog kind="actions" statuses={data.statuses} />}
        </>
      )}
    </ScrollView>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange(tab: Tab): void }) {
  const t = useTheme();
  const items: { id: Tab; label: string }[] = [
    { id: 'routines', label: 'Rotinas' },
    { id: 'actions', label: 'Ações' },
    { id: 'steps', label: 'Etapas' },
    { id: 'triggers', label: 'Gatilhos' },
  ];
  return (
    <View style={[styles.tabs, { backgroundColor: t.surface }]} accessibilityRole="tablist">
      {items.map((item) => {
        const active = item.id === tab;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.tab, active && { backgroundColor: t.accent }]}
          >
            <Text style={[styles.tabText, { color: active ? t.onAccent : t.muted }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const CATALOG_INTRO = {
  triggers: 'O que faz uma rotina disparar. Cada rotina tem um gatilho.',
  steps: `O que a rotina faz com o que o gatilho entregou, antes das ações. Até ${MAX_STEPS} etapas, em ordem. O Edji escreve as etapas a partir dos exemplos que você dá.`,
  actions: `O que a rotina faz quando dispara. Até ${MAX_ACTIONS} ações por rotina, em ordem.`,
};

/** What the agent can use to build a routine, with the permissions each one needs. */
function Catalog({ kind, statuses }: { kind: 'triggers' | 'steps' | 'actions'; statuses: RoutinesData['statuses'] }) {
  const t = useTheme();
  const entries: CatalogEntry<string>[] = kind === 'triggers' ? TRIGGER_CATALOG : kind === 'steps' ? STEP_CATALOG : ACTION_CATALOG;
  return (
    <View style={styles.list}>
      <Text style={[styles.intro, { color: t.muted }]}>{CATALOG_INTRO[kind]}</Text>
      {entries.map((e) => (
        <CatalogCard key={e.kind} entry={e} statuses={statuses} />
      ))}
    </View>
  );
}

function CatalogCard({
  entry,
  statuses,
}: {
  entry: CatalogEntry<string>;
  statuses: RoutinesData['statuses'];
}) {
  const t = useTheme();
  const missing = missingPermissions(entry.permissions, statuses);
  return (
    <View style={[styles.card, { backgroundColor: t.surface }]}>
      <Text style={[styles.name, { color: t.text }]}>{entry.title}</Text>
      <Text style={[styles.sentence, { color: t.text }]}>{entry.summary}</Text>
      {entry.note && <Text style={[styles.meta, styles.left, { color: t.muted }]}>{entry.note}</Text>}
      {entry.permissions.length > 0 && (
        <View style={styles.chips}>
          {entry.permissions.map((id) => {
            const ok = !missing.includes(id);
            return (
              <Text
                key={id}
                style={[styles.chip, { borderColor: ok ? t.muted : t.danger, color: ok ? t.muted : t.danger }, !ok && styles.bold]}
              >
                {ok ? '✓ ' : ''}
                {permissionById(id).label}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

const placeNameIn = (data: RoutinesData) => (id: string) => data.places.find((p) => p.id === id)?.name;

function RoutineList({ data, onOpen }: { data: RoutinesData; onOpen(id: string): void }) {
  const t = useTheme();
  return (
    <View style={styles.list}>
      {data.routines.map((r) => {
        const missing = missingPermissions(requiredPermissions(r), data.statuses);
        const failures = data.failures.filter((f) => f.routineId === r.id).length;
        const alert = missing.length > 0 || failures > 0;
        return (
          <Pressable key={r.id} onPress={() => onOpen(r.id)} style={[styles.card, { backgroundColor: t.surface }]}>
            <Text style={[styles.name, { color: t.text }]}>{r.name}</Text>
            <Text style={[styles.sentence, { color: t.muted }]}>{describeRoutine(r, { placeName: placeNameIn(data) })}</Text>
            <View style={styles.footer}>
              <EnabledPill enabled={r.enabled} />
              <Text style={[styles.meta, { color: alert ? t.danger : t.muted }, alert && styles.bold]}>
                {routineFooter(r, missing, failures)}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <View style={[styles.hintBox, { borderColor: t.line }]}>
        <Text style={[styles.hint, { color: t.text }]}>
          {data.routines.length === 0 ? 'Nenhuma rotina ainda. ' : ''}
          Para criar, mudar, ativar ou desativar uma rotina, segure o botão lateral e fale com o Edji. Ex.: “quando eu entrar no carro,
          abre o Spotify”.
        </Text>
      </View>
    </View>
  );
}

function RoutineDetail({ routine: r, data, onBack }: { routine: Routine; data: RoutinesData; onBack(): void }) {
  const t = useTheme();
  const required = requiredPermissions(r);
  const missing = missingPermissions(required, data.statuses);
  const runs = data.runs.filter((run) => run.routineId === r.id).slice(0, 10);
  const failures = data.failures.filter((f) => f.routineId === r.id);
  return (
    <View>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" style={styles.back}>
        <Text style={[styles.backText, { color: t.muted }]}>‹ Rotinas</Text>
      </Pressable>
      <Text style={[styles.title, { color: t.text }]}>{r.name}</Text>
      <View style={[styles.footer, { marginTop: 10 }]}>
        <EnabledPill enabled={r.enabled} />
        <Text style={[styles.meta, { color: t.muted }]}>
          Criada {r.createdBy === 'agent' ? 'pelo Edji ' : ''}em {formatWhen(r.createdAt).toLowerCase()}
        </Text>
      </View>

      <Section title="Quando">
        <Text style={[styles.row, { color: t.text }]}>{describeTrigger(r.trigger, { placeName: placeNameIn(data) })}</Text>
      </Section>

      {r.steps.length > 0 && (
        <Section title="Etapas">
          {r.steps.map((s, i) => (
            <Text key={s.id} style={[styles.row, { color: t.text }]}>
              {i + 1}. {capitalize(describeStep(s))}
            </Text>
          ))}
        </Section>
      )}

      <Section title="Então">
        {r.actions.map((a, i) => (
          <Text key={i} style={[styles.row, { color: t.text }]}>
            {i + 1}. {capitalize(describeAction(a))}
          </Text>
        ))}
      </Section>

      {required.length > 0 && (
        <Section title="Permissões">
          {required.map((id) => {
            const ok = !missing.includes(id);
            return (
              <Text key={id} style={[styles.row, { color: ok ? t.text : t.danger }]}>
                {ok ? '✓ ' : '• Falta: '}
                {permissionById(id).label}
              </Text>
            );
          })}
        </Section>
      )}

      {failures.length > 0 && (
        <Section title={`Falhas para corrigir (${failures.length})`}>
          {failures.slice(0, 10).map((f) => (
            <View key={f.id} style={styles.failure}>
              <Text style={[styles.row, styles.tight, { color: t.text }]}>{formatWhen(f.failedAt)}</Text>
              <Text style={[styles.meta, styles.left, { color: t.danger }]}>{f.reason}</Text>
            </View>
          ))}
          <Text style={[styles.meta, styles.left, styles.failureHint, { color: t.muted }]}>
            A entrada de cada falha fica guardada no aparelho. Peça ao Edji: “por que a rotina {r.name} falhou?”. Ele corrige a rotina e
            reprocessa.
          </Text>
        </Section>
      )}

      <Section title="Últimas execuções">
        {runs.length === 0 ? (
          <Text style={[styles.row, { color: t.muted }]}>Nunca rodou.</Text>
        ) : (
          runs.map((run) => (
            <View key={run.id} style={styles.runRow}>
              <Text style={[styles.row, { color: t.text }]}>{formatWhen(run.firedAt)}</Text>
              <Text style={[styles.runOutcome, { color: run.outcome === 'done' ? t.accent : t.danger }]}>{runLabel(run)}</Text>
            </View>
          ))
        )}
      </Section>

      <Text style={[styles.meta, styles.note, { color: t.muted }]}>
        Só o Edji muda rotinas. Fale “desativa a rotina {r.name}” ou “apaga a rotina {r.name}”.
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View>
      <Text style={[styles.section, { color: t.muted }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: t.surface }]}>{children}</View>
    </View>
  );
}

function EnabledPill({ enabled }: { enabled: boolean }) {
  const t = useTheme();
  return enabled ? (
    <Text style={[styles.pill, { backgroundColor: t.accent, color: t.onAccent }]}>Ativa</Text>
  ) : (
    <Text style={[styles.pill, styles.pillOff, { borderColor: t.muted, color: t.muted }]}>Desativada</Text>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: 40 },
  tabs: { flexDirection: 'row', borderRadius: 999, padding: 4, marginBottom: 16 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 },
  tabText: { fontSize: 14, fontWeight: '700' },
  intro: { fontSize: 14, lineHeight: 20 },
  left: { textAlign: 'left' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { fontSize: 12, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  list: { gap: 12 },
  card: { borderRadius: 18, padding: 16, gap: 6 },
  name: { fontSize: 17, fontWeight: '700' },
  sentence: { fontSize: 14, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  meta: { fontSize: 13, flexShrink: 1, textAlign: 'right' },
  bold: { fontWeight: '700' },
  pill: { fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  pillOff: { borderWidth: 1.5, paddingVertical: 3, paddingHorizontal: 9 },
  hintBox: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 18, padding: 16, marginTop: 8 },
  hint: { fontSize: 14, lineHeight: 20 },
  back: { paddingVertical: 4, marginBottom: 8 },
  backText: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  sectionCard: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 },
  row: { fontSize: 16, lineHeight: 22, paddingVertical: 6 },
  runRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  runOutcome: { fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  note: { textAlign: 'left', marginTop: 20, lineHeight: 19 },
  failure: { paddingVertical: 6, gap: 2 },
  tight: { paddingVertical: 0 },
  failureHint: { paddingVertical: 8, lineHeight: 19 },
});
