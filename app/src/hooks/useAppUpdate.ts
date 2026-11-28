import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { EdjiAssistant, type UpdateEvent } from '../../modules/edji-assistant';
import {
  autoCheck,
  checkForUpdate,
  isAutoCheckEnabled,
  isTestVersionsEnabled,
  setAutoCheck,
  setTestVersions,
  type UpdateCheck,
  type UpdatePhase,
} from '@/core/appUpdate';
import { getDb } from '@/core/db';
import { requestPermission } from '@/core/devicePermissions';
import { ensureReady } from '@/core/runtime';

export type AppUpdate = {
  /** Installed version, or null where there is no native module (no in-app update). */
  installed: { versionName: string; versionCode: number } | null;
  /** Result of the last check in this run of the app. */
  check: UpdateCheck | null;
  phase: UpdatePhase;
  /** Download progress, 0 to 1, while downloading. */
  progress: number | null;
  /** Short Portuguese message about the last attempt (failure, cancel, missing permission). */
  message: string | null;
  /** The automatic daily check; null until read. */
  autoCheck: boolean | null;
  /** Release candidates count as updates; null until read. */
  testVersions: boolean | null;
  checkNow(): Promise<void>;
  setAuto(enabled: boolean): Promise<void>;
  setTestVersions(enabled: boolean): Promise<void>;
  install(): Promise<void>;
};

/**
 * In-app update state (ADR 0007), one per app: the shell owns it and hands it
 * to the chat banner and the settings. Checks on start only with the opt-in.
 */
export function useAppUpdate(): AppUpdate {
  const [installed] = useState(() => (Platform.OS === 'android' ? (EdjiAssistant?.installedVersion?.() ?? null) : null));
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [auto, setAutoState] = useState<boolean | null>(null);
  const [testVersions, setTestState] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      await ensureReady();
      const db = await getDb();
      const enabled = await isAutoCheckEnabled(db);
      const tests = await isTestVersionsEnabled(db);
      if (!active) return;
      setAutoState(enabled);
      setTestState(tests);
      if (!installed) return;
      const result = await autoCheck(db, installed.versionCode, Date.now());
      if (active && result) setCheck(result);
    })();
    return () => {
      active = false;
    };
  }, [installed]);

  useEffect(() => {
    if (!EdjiAssistant || !installed) return;
    const sub = EdjiAssistant.addListener('onUpdate', (e: UpdateEvent) => {
      switch (e.state) {
        case 'downloading':
          setPhase('downloading');
          setProgress(e.total > 0 ? e.downloaded / e.total : null);
          break;
        case 'waiting_user':
          setPhase('waiting_user');
          setProgress(null);
          break;
        case 'installed':
          // The new version usually replaces this process before it gets here.
          setPhase('idle');
          break;
        case 'cancelled':
          setPhase('idle');
          setProgress(null);
          setMessage('Atualização cancelada.');
          break;
        case 'failed':
          setPhase('idle');
          setProgress(null);
          setMessage(e.message ?? 'Não deu para instalar a atualização.');
          break;
      }
    });
    return () => sub.remove();
  }, [installed]);

  const checkNow = useCallback(async () => {
    if (!installed) return;
    setPhase('checking');
    setMessage(null);
    setCheck(await checkForUpdate(installed.versionCode, { testVersions: await isTestVersionsEnabled(await getDb()) }));
    setPhase('idle');
  }, [installed]);

  const setAuto = useCallback(async (enabled: boolean) => {
    setAutoState(enabled);
    await setAutoCheck(await getDb(), enabled);
  }, []);

  const setTests = useCallback(async (enabled: boolean) => {
    setTestState(enabled);
    // The last answer came from the other channel.
    setCheck(null);
    await setTestVersions(await getDb(), enabled);
  }, []);

  const install = useCallback(async () => {
    if (!EdjiAssistant || check?.status !== 'available') return;
    if (!EdjiAssistant.canInstallUpdates()) {
      setMessage('Permita que o Edji instale apps e toque em Atualizar de novo.');
      await requestPermission('install_updates');
      return;
    }
    const { apkUrl, sha256, size } = check.release;
    setMessage(null);
    setPhase('downloading');
    setProgress(0);
    const problem = await EdjiAssistant.installUpdate(apkUrl, sha256, size);
    if (problem) {
      setPhase('idle');
      setProgress(null);
      setMessage(problem);
    }
  }, [check]);

  return { installed, check, phase, progress, message, autoCheck: auto, testVersions, checkNow, setAuto, setTestVersions: setTests, install };
}
