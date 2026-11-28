import { Pressable, Switch, Text, View } from 'react-native';
import { canAct, statusLine } from '@/core/appUpdate';
import type { AppUpdate } from '@/hooks/useAppUpdate';
import { useTheme } from '@/theme';
import { settingsStyles as styles } from './styles';

type Props = { update: AppUpdate };

/** Installed version, the manual check, the automatic check opt-in and the update itself (ADR 0007). */
export function UpdateSettings({ update }: Props) {
  const t = useTheme();
  const { installed, check, phase, autoCheck, message } = update;
  const free = canAct(phase);

  return (
    <>
      <Text style={[styles.section, { color: t.muted }]}>Atualizações</Text>
      <View style={[styles.card, { backgroundColor: t.surface }]}>
        {!installed ? (
          <Text style={[styles.hint, { color: t.muted }]}>Atualizar pelo app só funciona no Android.</Text>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: t.text }]}>Edji {installed.versionName}</Text>
                <Text style={[styles.meta, { color: t.muted }]}>{statusLine(update.check, update.phase, update.progress)}</Text>
              </View>
              {check?.status === 'available' ? (
                <Pressable
                  onPress={update.install}
                  disabled={!free}
                  accessibilityRole="button"
                  style={[styles.button, { borderColor: t.accent, backgroundColor: t.accent, opacity: free ? 1 : 0.5 }]}
                >
                  <Text style={{ color: t.onAccent, fontWeight: '700' }}>Atualizar</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={update.checkNow}
                  disabled={!free}
                  accessibilityRole="button"
                  style={[styles.button, { borderColor: t.accent, opacity: free ? 1 : 0.5 }]}
                >
                  <Text style={{ color: t.accent, fontWeight: '700' }}>Procurar</Text>
                </Pressable>
              )}
            </View>
            {check?.status === 'available' && check.release.notes.length > 0 && (
              <View style={{ gap: 4 }}>
                {check.release.notes.map((n, i) => (
                  <Text key={i} style={[styles.hint, { color: t.text }]}>
                    • {n}
                  </Text>
                ))}
              </View>
            )}
            {message && <Text style={[styles.hint, { color: t.danger, fontWeight: '700' }]}>{message}</Text>}
            <View style={[styles.divider, { backgroundColor: t.line }]} />
            <View style={styles.pluginRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: t.text }]}>Procurar sozinho</Text>
                <Text style={[styles.meta, { color: t.muted }]}>Uma vez por dia, ao abrir o Edji.</Text>
              </View>
              <Switch
                value={autoCheck ?? false}
                disabled={autoCheck === null}
                onValueChange={update.setAuto}
                trackColor={{ true: t.accent }}
                accessibilityLabel="Procurar atualizações sozinho"
              />
            </View>
            <Text style={[styles.hint, { color: t.muted }]}>
              Procurar consulta o GitHub, que vê o seu IP. Nada do Edji é enviado. O Android pede para confirmar a instalação.
            </Text>
          </>
        )}
      </View>
    </>
  );
}
