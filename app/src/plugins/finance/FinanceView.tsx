import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PluginContext } from '@/core/plugin';
import { useTheme } from '@/theme';
import { CategoryEditor } from './components/CategoryEditor';
import { CategoryPicker } from './components/CategoryPicker';
import { ChangesCard } from './components/ChangesCard';
import { MonthCalendar } from './components/MonthCalendar';
import { Section } from './components/Section';
import { SmallThingsCard } from './components/SmallThingsCard';
import { SplitCard } from './components/SplitCard';
import { StoryHero } from './components/StoryHero';
import { TransactionRow } from './components/TransactionRow';
import { MIN_COVERAGE } from './insights';
import { monthOnly } from './money';
import type { CategoryWithCount, Transaction } from './transaction';
import { useFinance } from './useFinance';

/**
 * A month of spending told as facts computed on the device (no model): what
 * changed against the same days of last month, whether it was buying more
 * often or paying more, each day, and small things that add up. Then the
 * entries, where tapping one picks its category, and the categories.
 */
export function FinanceView({ ctx }: { ctx: PluginContext }) {
  const t = useTheme();
  const f = useFinance(ctx);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState<CategoryWithCount | null>(null);
  const [day, setDay] = useState<number | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    await f.reload();
    setRefreshing(false);
  };

  const { data, story } = f;
  if (!data || !story) return null;
  const prevName = monthOnly(data.month === 1 ? 12 : data.month - 1);
  const dayEntries = day === null ? [] : data.transactions.filter((tx) => new Date(tx.occurredAt).getDate() === day);
  const hasSpending = story.spentCents > 0;

  const changeMonth = (go: () => void) => {
    setDay(null);
    go();
  };

  return (
    <ScrollView contentContainerStyle={styles.root} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <StoryHero
        year={data.year}
        month={data.month}
        story={story}
        inCents={data.inCents}
        canGoNext={!f.isCurrent}
        onPrevious={() => changeMonth(f.previousMonth)}
        onNext={() => changeMonth(f.nextMonth)}
      />

      {hasSpending && story.coverage < 1 && (
        <View style={[styles.notice, { borderColor: t.line }]}>
          <Text style={[styles.noticeText, { color: t.text }]}>
            {Math.floor(story.coverage * 100)}% dos gastos têm categoria.
            {!story.showCategories && ` As análises por categoria aparecem a partir de ${Math.round(MIN_COVERAGE * 100)}%.`} Toque num registro
            ou diga “Edji, categoriza meus gastos”.
          </Text>
        </View>
      )}

      {story.changes && story.showCategories && (
        <Section eyebrow="O que mudou" title={story.changes.headline} lead={`Contra os mesmos dias de ${prevName}.`}>
          <ChangesCard rows={story.changes.rows} />
        </Section>
      )}

      {story.split && (
        <Section
          eyebrow="Mais vezes ou mais caro?"
          title={story.split.headline}
          lead="Um gasto sobe porque você comprou mais vezes ou porque cada compra ficou mais cara. Saber qual mostra onde cortar."
        >
          <SplitCard rows={story.split.rows} />
        </Section>
      )}

      {hasSpending && (
        <Section eyebrow="Dia a dia" title={story.calendar.headline}>
          <MonthCalendar days={story.calendar.days} firstWeekday={story.calendar.firstWeekday} selected={day} onSelect={setDay} />
          {day === null ? (
            <Text style={[styles.hint, { color: t.muted }]}>Toque num dia para ver o que saiu.</Text>
          ) : dayEntries.length === 0 ? (
            <Text style={[styles.hint, { color: t.muted }]}>Nada registrado no dia {day}.</Text>
          ) : (
            <View>
              {dayEntries.map((tx, i) => (
                <TransactionRow key={tx.id} tx={tx} onPress={() => setPicking(tx)} last={i === dayEntries.length - 1} />
              ))}
            </View>
          )}
        </Section>
      )}

      {(story.small.length > 0 || story.recurring.items.length > 0) && (
        <Section eyebrow="Pequenos que somam" title="Separados parecem pouco. Somados no ano, não.">
          <SmallThingsCard small={story.small} recurring={story.recurring} />
        </Section>
      )}

      <Section eyebrow="Registros" title={null}>
        {data.transactions.length === 0 ? (
          <Text style={[styles.hint, { color: t.text }]}>
            Nada registrado neste mês. Fale com o Edji, ex.: “gastei 30 reais no almoço”, ou peça uma rotina que registre as notificações do
            seu banco.
          </Text>
        ) : (
          <View>
            {data.transactions.map((tx, i) => (
              <TransactionRow key={tx.id} tx={tx} onPress={() => setPicking(tx)} last={i === data.transactions.length - 1} />
            ))}
          </View>
        )}
      </Section>

      <Section
        eyebrow="Categorias"
        lead={data.categories.length ? 'Toque numa categoria para renomear, juntar com outra ou apagar.' : 'Nenhuma ainda. Crie tocando num registro.'}
      >
        {data.categories.length > 0 && (
          <View>
            {data.categories.map((c, i) => (
              <Pressable
                key={c.id}
                onPress={() => setEditing(c)}
                accessibilityRole="button"
                style={[styles.catRow, i < data.categories.length - 1 && { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={[styles.catName, { color: t.text }]} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={[styles.catCount, { color: t.muted }]}>{c.count === 1 ? '1 registro' : `${c.count} registros`}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Section>

      {picking && (
        <CategoryPicker
          tx={picking}
          categories={data.categories}
          onClose={() => setPicking(null)}
          onPick={async (target, name) => {
            const result = await f.categorize(target, name);
            if (!result.ok) return result.reason;
            setPicking(null);
            return null;
          }}
        />
      )}
      {editing && (
        <CategoryEditor
          category={editing}
          onClose={() => setEditing(null)}
          onRename={async (to) => {
            const result = await f.renameCategory(editing.name, to);
            if (!result.ok) return result.reason;
            setEditing(null);
            return null;
          }}
          onDelete={async () => {
            await f.deleteCategory(editing.id);
            setEditing(null);
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: 48 },
  notice: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 18, padding: 14, marginTop: 16 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 14, lineHeight: 20 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  catName: { flex: 1, fontSize: 16, fontWeight: '700' },
  catCount: { fontSize: 13 },
});
