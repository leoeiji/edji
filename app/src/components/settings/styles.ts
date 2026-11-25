import { StyleSheet } from 'react-native';

/** Styles shared by the settings sections. */
export const settingsStyles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  card: { borderRadius: 18, padding: 16, gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  pluginRow: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 16 },
  meta: { fontSize: 13, marginTop: 2 },
  hint: { fontSize: 13, lineHeight: 19 },
  button: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: '500' },
  input: { borderWidth: 1.5, borderRadius: 12, minHeight: 48, paddingHorizontal: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  inputText: { flex: 1, fontSize: 16, paddingVertical: 10 },
  inputSolo: { fontSize: 16, paddingVertical: 10 },
  inputAction: { paddingHorizontal: 10, paddingVertical: 8 },
  divider: { height: StyleSheet.hairlineWidth },
});
