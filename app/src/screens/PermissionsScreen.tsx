import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { settingsStyles } from '@/components/settings/styles';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSION_GROUPS, PERMISSIONS, type Permission, type PermissionStatus } from '@/core/permissions';
import { useTheme } from '@/theme';

/** Every device permission Edji uses, grouped, with a way to grant what is missing (ADR 0005). */
export function PermissionsScreen() {
  const t = useTheme();
  const { statuses, request } = usePermissions();
  const known = statuses ? PERMISSIONS.filter((p) => statuses[p.id] !== 'unavailable') : [];
  const missing = known.filter((p) => statuses?.[p.id] === 'denied').length;

  return (
    <ScrollView contentContainerStyle={settingsStyles.root}>
      <Text style={[styles.intro, { color: t.muted }]}>
        {missing === 0 ? 'Tudo o que o Edji já usa está permitido.' : `Faltam ${missing} de ${known.length}.`} Cada rotina diz o que
        precisa; sem a permissão, ela não roda e o Edji avisa.
      </Text>

      {PERMISSION_GROUPS.map((g) => (
        <View key={g.id}>
          <Text style={[settingsStyles.section, { color: t.muted }]}>{g.title}</Text>
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            {PERMISSIONS.filter((p) => p.group === g.id).map((p) => (
              <PermissionRow key={p.id} permission={p} status={statuses?.[p.id] ?? null} onRequest={() => request(p.id)} />
            ))}
          </View>
          {g.id === 'voice' && (
            <Text style={[settingsStyles.hint, styles.hint, { color: t.muted }]}>
              No Galaxy: Configurações → Recursos avançados → Botão lateral → Pressionar e manter → Assistente digital. O menu de
              desligar passa a ficar no painel rápido.
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

type RowProps = { permission: Permission; status: PermissionStatus | null; onRequest(): void };

function PermissionRow({ permission: p, status, onRequest }: RowProps) {
  const t = useTheme();
  const granted = status === 'granted';
  const denied = status === 'denied';
  return (
    <View style={styles.row}>
      <View
        accessibilityLabel={granted ? 'Permitida' : denied ? 'Faltando' : 'Em breve'}
        style={[
          styles.mark,
          granted && { backgroundColor: t.accent },
          denied && { borderWidth: 2, borderColor: t.danger },
          status === 'unavailable' && { borderWidth: 2, borderColor: t.line },
        ]}
      >
        {granted && <Text style={[styles.check, { color: t.onAccent }]}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[settingsStyles.label, { color: t.text }]}>{p.label}</Text>
        <Text style={[settingsStyles.meta, { color: t.muted }]}>
          {p.recommended ? `Recomendada. ${p.reason}` : p.reason}
          {status === 'unavailable' ? ' Em breve.' : ''}
        </Text>
      </View>
      {denied && (
        <Pressable onPress={onRequest} style={[settingsStyles.button, { borderColor: t.accent }]}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>{p.kind === 'runtime' ? 'Permitir' : 'Configurar'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, lineHeight: 21, marginTop: 4 },
  card: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 44 },
  mark: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  check: { fontSize: 13, fontWeight: '700' },
  hint: { marginTop: 8 },
});
