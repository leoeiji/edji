import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { EdjiAssistant } from '../../../modules/edji-assistant';
import { useTheme } from '@/theme';
import { settingsStyles as styles } from './styles';

/**
 * Opt-in for routines that ask the agent (ADR 0005). Off by default: with it
 * off, nothing a routine reads (like a bank notification) leaves the device.
 */
export function RoutinesSettings() {
  const t = useTheme();
  const [allowed, setAllowed] = useState(() => EdjiAssistant?.isRoutinesAgentAllowed() ?? false);
  if (!EdjiAssistant) return null;

  const toggle = (value: boolean) => {
    EdjiAssistant?.setRoutinesAgentAllowed(value);
    setAllowed(value);
  };

  return (
    <>
      <Text style={[styles.section, { color: t.muted }]}>Rotinas</Text>
      <View style={[styles.card, { backgroundColor: t.surface }]}>
        <View style={styles.pluginRow}>
          <Text style={[styles.label, { color: t.text, flex: 1 }]}>Rotinas podem enviar texto ao agente</Text>
          <Switch
            value={allowed}
            onValueChange={toggle}
            trackColor={{ true: t.accent }}
            accessibilityLabel="Rotinas podem enviar texto ao agente"
          />
        </View>
        <Text style={[styles.hint, { color: t.muted }]}>
          Desligado, nada sai do aparelho. Ligado, rotinas com “Perguntar ao agente” mandam ao OpenRouter só o texto que a rotina indicar
          (ex.: uma notificação do banco), mesmo com você longe do celular.
        </Text>
      </View>
    </>
  );
}
