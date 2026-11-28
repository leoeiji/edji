import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from './chatStore';
import { versionCode } from './version';

/**
 * In-app update from GitHub Releases (ADR 0007). This side finds the latest
 * release and decides whether it is newer; the native module downloads,
 * checks and installs it. The only request is a GET to the GitHub API, made
 * when the user taps "Procurar atualização" or turned on the automatic check.
 */

/** Latest published release; GitHub leaves drafts and prereleases out of it. */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/leoeiji/edji/releases/latest';

/** "1" when the user turned on the automatic check. Off by default (no network without opt-in). */
export const AUTO_CHECK_SETTING = 'update.auto_check';
/** Epoch ms of the last automatic check that got an answer. */
export const LAST_CHECK_SETTING = 'update.last_check_at';
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How many changes of a release the app shows. */
const MAX_NOTES = 8;

export type Release = {
  version: string;
  versionCode: number;
  /** Changes, one short line each, from the auto-generated notes. */
  notes: string[];
  pageUrl: string;
  apkUrl: string;
  /** Hex SHA-256 of the APK, from the asset's `digest`. */
  sha256: string;
  size: number;
};

export type UpdateCheck =
  | { status: 'available'; release: Release }
  | { status: 'up-to-date'; latest: string }
  | { status: 'error'; message: string };

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'waiting_user';

/**
 * Whether the buttons work in [phase]. `waiting_user` counts as free: the user
 * may have left the system confirmation with Home, or Android may not have
 * shown it, and tapping again just starts a new install session.
 */
export function canAct(phase: UpdatePhase): boolean {
  return phase === 'idle' || phase === 'waiting_user';
}

type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Asks GitHub for the latest release and compares it with [installedCode].
 * Never throws: network and format problems come back as `error` with a
 * short Portuguese message.
 */
export async function checkForUpdate(installedCode: number, fetchFn: FetchFn = fetch): Promise<UpdateCheck> {
  let body: unknown;
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 403 || res.status === 429) return { status: 'error', message: 'O GitHub limitou as consultas. Tente mais tarde.' };
    if (res.status === 404) return { status: 'error', message: 'Ainda não há versão publicada.' };
    if (!res.ok) return { status: 'error', message: `O GitHub respondeu com erro ${res.status}. Tente mais tarde.` };
    body = await res.json();
  } catch {
    return { status: 'error', message: 'Sem conexão com o GitHub. Confira a internet.' };
  }
  const release = parseRelease(body);
  if (typeof release === 'string') return { status: 'error', message: release };
  if (release.versionCode <= installedCode) return { status: 'up-to-date', latest: release.version };
  return { status: 'available', release };
}

/**
 * The release in a GitHub API response, or why it can't be used. The APK must
 * be named `edji-<version>.apk` and carry a sha256 digest (release.yaml).
 */
export function parseRelease(json: unknown): Release | string {
  if (!isRecord(json) || typeof json.tag_name !== 'string') return 'Resposta inesperada do GitHub.';
  const version = json.tag_name.replace(/^v/, '');
  let code: number;
  try {
    code = versionCode(version);
  } catch {
    return `A versão ${json.tag_name} não tem o formato esperado.`;
  }
  const name = `edji-${version}.apk`;
  const asset = (Array.isArray(json.assets) ? json.assets : []).find((a): a is Record<string, unknown> => isRecord(a) && a.name === name);
  if (!asset || typeof asset.browser_download_url !== 'string') return `A versão ${version} não tem o APK.`;
  const digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest) : null;
  if (!digest) return `A versão ${version} não tem o hash do APK.`;
  return {
    version,
    versionCode: code,
    notes: releaseNotes(typeof json.body === 'string' ? json.body : ''),
    pageUrl: typeof json.html_url === 'string' ? json.html_url : '',
    apkUrl: asset.browser_download_url,
    sha256: digest[1].toLowerCase(),
    size: typeof asset.size === 'number' ? asset.size : 0,
  };
}

/**
 * The change lines of GitHub's auto-generated notes, without the author and
 * PR link ("* Add X by @user in https://…/pull/7" → "Add X").
 */
export function releaseNotes(body: string): string[] {
  return body
    .split('\n')
    .map((l) => /^\s*[*-]\s+(.+)$/.exec(l)?.[1])
    .filter((l): l is string => !!l)
    .map((l) => l.replace(/\s+by @\S+ in https?:\/\/\S+$/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_NOTES);
}

/** Whether the automatic check should run now: turned on, and no answer in the last day. */
export function autoCheckDue(enabled: boolean, lastCheckAt: number | null, now: number): boolean {
  if (!enabled) return false;
  return lastCheckAt === null || now - lastCheckAt >= AUTO_CHECK_INTERVAL_MS || now < lastCheckAt;
}

export async function isAutoCheckEnabled(db: SQLiteDatabase): Promise<boolean> {
  return (await getSetting(db, AUTO_CHECK_SETTING)) === '1';
}

export async function setAutoCheck(db: SQLiteDatabase, enabled: boolean): Promise<void> {
  await setSetting(db, AUTO_CHECK_SETTING, enabled ? '1' : '0');
}

/**
 * The automatic check on app start: null without the opt-in or when it
 * already got an answer in the last day. A failed request doesn't count, so
 * the next start tries again.
 */
export async function autoCheck(db: SQLiteDatabase, installedCode: number, now: number, fetchFn: FetchFn = fetch): Promise<UpdateCheck | null> {
  const last = await getSetting(db, LAST_CHECK_SETTING);
  if (!autoCheckDue(await isAutoCheckEnabled(db), last === null ? null : Number(last), now)) return null;
  const result = await checkForUpdate(installedCode, fetchFn);
  if (result.status !== 'error') await setSetting(db, LAST_CHECK_SETTING, String(now));
  return result;
}

/** One short line on what the last check or the install is doing, for the settings and the chat banner. */
export function statusLine(check: UpdateCheck | null, phase: UpdatePhase, progress: number | null): string {
  if (phase === 'checking') return 'Procurando…';
  if (phase === 'downloading') return progress === null ? 'Baixando…' : `Baixando… ${Math.round(progress * 100)}%`;
  if (phase === 'waiting_user') return 'Confirme a instalação.';
  if (!check) return 'Toque em Procurar para ver se há versão nova.';
  if (check.status === 'available') return `Versão ${check.release.version} disponível.`;
  if (check.status === 'up-to-date') return 'Você está na versão mais nova.';
  return check.message;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
