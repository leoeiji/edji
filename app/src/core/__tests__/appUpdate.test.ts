import type { SQLiteDatabase } from 'expo-sqlite';
import { openTestDb } from '@/testing/nodeSqlite';
import {
  AUTO_CHECK_INTERVAL_MS,
  LAST_CHECK_SETTING,
  LATEST_RELEASE_URL,
  RELEASES_URL,
  autoCheck,
  autoCheckDue,
  canAct,
  checkForUpdate,
  isAutoCheckEnabled,
  isTestVersionsEnabled,
  newestRelease,
  parseRelease,
  releaseNotes,
  setAutoCheck,
  setTestVersions,
  statusLine,
} from '../appUpdate';
import { CHAT_MIGRATIONS, CHAT_SCHEMA_ID, getSetting } from '../chatStore';
import { applyMigrations } from '../db';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

const SHA = 'ab'.repeat(32);

/** A trimmed GitHub API response for a release. */
function release(tag: string, overrides: Record<string, unknown> = {}) {
  const version = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    html_url: `https://github.com/leoeiji/edji/releases/tag/${tag}`,
    body: `## What's Changed\n* Add in-app update by @someone in https://github.com/leoeiji/edji/pull/8\n* Fix chat scroll by @someone in https://github.com/leoeiji/edji/pull/9\n\n**Full Changelog**: https://github.com/leoeiji/edji/compare/v0.2.0...${tag}`,
    assets: [
      { name: 'notes.txt', browser_download_url: 'https://example.invalid/notes.txt', digest: `sha256:${SHA}`, size: 10 },
      {
        name: `edji-${version}.apk`,
        browser_download_url: `https://github.com/leoeiji/edji/releases/download/${tag}/edji-${version}.apk`,
        digest: `sha256:${SHA.toUpperCase()}`,
        size: 76_436_846,
      },
    ],
    ...overrides,
  };
}

function respond(status: number, body: unknown = {}) {
  return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

describe('parseRelease', () => {
  it('takes the APK named after the version, with its digest, size and notes', () => {
    expect(parseRelease(release('v0.3.0'))).toEqual({
      version: '0.3.0',
      versionCode: 30099,
      notes: ['Add in-app update', 'Fix chat scroll'],
      pageUrl: 'https://github.com/leoeiji/edji/releases/tag/v0.3.0',
      apkUrl: 'https://github.com/leoeiji/edji/releases/download/v0.3.0/edji-0.3.0.apk',
      sha256: SHA,
      size: 76_436_846,
    });
  });

  it('refuses a release without the APK, without a digest or with an odd tag', () => {
    expect(parseRelease(release('v0.3.0', { assets: [] }))).toBe('A versão 0.3.0 não tem o APK.');
    const noDigest = release('v0.3.0');
    delete (noDigest.assets[1] as Record<string, unknown>).digest;
    expect(parseRelease(noDigest)).toBe('A versão 0.3.0 não tem o hash do APK.');
    expect(parseRelease(release('v1.2.3-beta'))).toBe('A versão v1.2.3-beta não tem o formato esperado.');
    expect(parseRelease(null)).toBe('Resposta inesperada do GitHub.');
    expect(parseRelease([])).toBe('Resposta inesperada do GitHub.');
  });

  it('takes a release candidate', () => {
    expect(parseRelease(release('v0.3.0-rc.2'))).toMatchObject({
      version: '0.3.0-rc.2',
      versionCode: 30002,
      apkUrl: 'https://github.com/leoeiji/edji/releases/download/v0.3.0-rc.2/edji-0.3.0-rc.2.apk',
    });
  });
});

describe('newestRelease', () => {
  it('takes the highest version, whatever the order of the list', () => {
    const list = [release('v0.3.0-rc.2', { prerelease: true }), release('v0.3.0'), release('v0.3.0-rc.1', { prerelease: true })];
    expect(newestRelease(list)).toMatchObject({ version: '0.3.0' });
    expect(newestRelease([release('v0.2.0'), release('v0.3.0-rc.1', { prerelease: true })])).toMatchObject({ version: '0.3.0-rc.1' });
  });

  it('skips drafts and releases the app cannot use', () => {
    const list = [release('v0.4.0', { draft: true }), release('v0.3.1', { assets: [] }), release('v0.3.0')];
    expect(newestRelease(list)).toMatchObject({ version: '0.3.0' });
  });

  it('says why when nothing fits', () => {
    expect(newestRelease([])).toBe('Ainda não há versão publicada.');
    expect(newestRelease([release('v0.3.1', { assets: [] })])).toBe('A versão 0.3.1 não tem o APK.');
    expect(newestRelease({})).toBe('Resposta inesperada do GitHub.');
  });
});

describe('releaseNotes', () => {
  it('keeps the change lines without author and link', () => {
    expect(releaseNotes('## What\'s Changed\n- Rotinas novas by @a in https://x.invalid/pull/1\n* Só texto\n\nOutro parágrafo')).toEqual([
      'Rotinas novas',
      'Só texto',
    ]);
    expect(releaseNotes('')).toEqual([]);
  });

  it('shows at most eight changes', () => {
    expect(releaseNotes(Array.from({ length: 12 }, (_, i) => `* Mudança ${i}`).join('\n'))).toHaveLength(8);
  });
});

describe('checkForUpdate', () => {
  it('asks the latest release of the Edji repository', async () => {
    const fetchFn = respond(200, release('v0.3.0'));
    await checkForUpdate(200, { fetchFn });
    expect(fetchFn).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.anything());
    expect(LATEST_RELEASE_URL).toBe('https://api.github.com/repos/leoeiji/edji/releases/latest');
  });

  it('asks the recent releases, candidates included, only with test versions', async () => {
    const fetchFn = respond(200, [release('v0.3.0-rc.1', { prerelease: true }), release('v0.2.0')]);
    expect(await checkForUpdate(199, { testVersions: true, fetchFn })).toMatchObject({ status: 'available', release: { version: '0.3.0-rc.1' } });
    expect(fetchFn).toHaveBeenCalledWith(RELEASES_URL, expect.anything());
    expect(RELEASES_URL).toBe('https://api.github.com/repos/leoeiji/edji/releases?per_page=20');
  });

  it('offers the final release over its candidate', async () => {
    expect(await checkForUpdate(30001, { fetchFn: respond(200, release('v0.3.0')) })).toMatchObject({ status: 'available' });
    expect(await checkForUpdate(30001, { testVersions: true, fetchFn: respond(200, [release('v0.3.0'), release('v0.3.0-rc.1')]) })).toMatchObject({
      status: 'available',
      release: { version: '0.3.0' },
    });
  });

  it('offers a newer version', async () => {
    const result = await checkForUpdate(200, { fetchFn: respond(200, release('v0.3.0')) });
    expect(result).toMatchObject({ status: 'available', release: { version: '0.3.0', versionCode: 30099 } });
  });

  it('is up to date on the same or an older version', async () => {
    expect(await checkForUpdate(30099, { fetchFn: respond(200, release('v0.3.0')) })).toEqual({ status: 'up-to-date', latest: '0.3.0' });
    expect(await checkForUpdate(1000099, { fetchFn: respond(200, release('v0.3.0')) })).toEqual({ status: 'up-to-date', latest: '0.3.0' });
  });

  it('turns network and GitHub errors into short messages instead of throwing', async () => {
    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    expect(await checkForUpdate(200, { fetchFn: offline })).toEqual({ status: 'error', message: 'Sem conexão com o GitHub. Confira a internet.' });
    expect(await checkForUpdate(200, { fetchFn: respond(403) })).toEqual({ status: 'error', message: 'O GitHub limitou as consultas. Tente mais tarde.' });
    expect(await checkForUpdate(200, { fetchFn: respond(404) })).toEqual({ status: 'error', message: 'Ainda não há versão publicada.' });
    expect(await checkForUpdate(200, { fetchFn: respond(502) })).toMatchObject({ status: 'error' });
    expect(await checkForUpdate(200, { fetchFn: respond(200, release('v0.3.0', { assets: [] })) })).toEqual({
      status: 'error',
      message: 'A versão 0.3.0 não tem o APK.',
    });
  });
});

describe('autoCheckDue', () => {
  const now = 1_800_000_000_000;

  it('never runs without the opt-in', () => {
    expect(autoCheckDue(false, null, now)).toBe(false);
  });

  it('runs at most once a day', () => {
    expect(autoCheckDue(true, null, now)).toBe(true);
    expect(autoCheckDue(true, now - AUTO_CHECK_INTERVAL_MS + 1, now)).toBe(false);
    expect(autoCheckDue(true, now - AUTO_CHECK_INTERVAL_MS, now)).toBe(true);
  });

  it('runs again when the clock went back', () => {
    expect(autoCheckDue(true, now + 1000, now)).toBe(true);
  });
});

describe('autoCheck', () => {
  let db: SQLiteDatabase;
  const now = 1_800_000_000_000;

  beforeEach(async () => {
    db = openTestDb();
    await db.execAsync('CREATE TABLE plugin_schema (id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    await applyMigrations(db, CHAT_SCHEMA_ID, CHAT_MIGRATIONS);
  });

  it('is off by default and makes no request', async () => {
    const fetchFn = respond(200, release('v0.3.0'));
    expect(await isAutoCheckEnabled(db)).toBe(false);
    expect(await autoCheck(db, 200, now, fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('checks once a day after the opt-in', async () => {
    await setAutoCheck(db, true);
    const fetchFn = respond(200, release('v0.3.0'));
    expect(await autoCheck(db, 200, now, fetchFn)).toMatchObject({ status: 'available' });
    expect(await getSetting(db, LAST_CHECK_SETTING)).toBe(String(now));
    expect(await autoCheck(db, 200, now + 60_000, fetchFn)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next start when the request failed', async () => {
    await setAutoCheck(db, true);
    expect(await autoCheck(db, 200, now, respond(502))).toMatchObject({ status: 'error' });
    expect(await getSetting(db, LAST_CHECK_SETTING)).toBeNull();
  });

  it('follows the test versions opt-in, off by default', async () => {
    await setAutoCheck(db, true);
    expect(await isTestVersionsEnabled(db)).toBe(false);
    await setTestVersions(db, true);
    const fetchFn = respond(200, [release('v0.3.0-rc.1', { prerelease: true })]);
    expect(await autoCheck(db, 199, now, fetchFn)).toMatchObject({ status: 'available', release: { version: '0.3.0-rc.1' } });
    expect(fetchFn).toHaveBeenCalledWith(RELEASES_URL, expect.anything());
  });

  it('stops after the user turns it off', async () => {
    await setAutoCheck(db, true);
    await setAutoCheck(db, false);
    const fetchFn = respond(200, release('v0.3.0'));
    expect(await autoCheck(db, 200, now, fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('statusLine', () => {
  it('says what is happening in short Portuguese', () => {
    const available = parseRelease(release('v0.3.0'));
    if (typeof available === 'string') throw new Error(available);
    expect(statusLine(null, 'idle', null)).toBe('Toque em Procurar para ver se há versão nova.');
    expect(statusLine(null, 'checking', null)).toBe('Procurando…');
    expect(statusLine({ status: 'available', release: available }, 'idle', null)).toBe('Versão 0.3.0 disponível.');
    expect(statusLine({ status: 'available', release: available }, 'downloading', 0.426)).toBe('Baixando… 43%');
    expect(statusLine({ status: 'available', release: available }, 'waiting_user', null)).toBe('Confirme a instalação.');
    expect(statusLine({ status: 'up-to-date', latest: '0.3.0' }, 'idle', null)).toBe('Você está na versão mais nova.');
    expect(statusLine({ status: 'error', message: 'Sem conexão com o GitHub. Confira a internet.' }, 'idle', null)).toBe(
      'Sem conexão com o GitHub. Confira a internet.',
    );
  });
});

describe('canAct', () => {
  it('lets the user tap again while the system confirmation may be gone, not while busy', () => {
    expect(canAct('idle')).toBe(true);
    expect(canAct('waiting_user')).toBe(true);
    expect(canAct('checking')).toBe(false);
    expect(canAct('downloading')).toBe(false);
  });
});
