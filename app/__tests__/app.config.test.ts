import { version } from '../package.json';
import config, { patchReleaseSigning, versionCode } from '../app.config';
import { versionCode as appVersionCode } from '../src/core/version';

describe('versionCode', () => {
  it.each([
    ['0.0.1', 199],
    ['0.1.0', 10099],
    ['0.3.0-rc.1', 30001],
    ['0.3.0-rc.12', 30012],
    ['0.3.0', 30099],
    ['1.2.3', 1020399],
    ['2.99.99-rc.98', 2999998],
  ])('%s → %i', (semver, code) => {
    expect(versionCode(semver)).toBe(code);
  });

  it.each(['1.2', '1.100.0', '1.2.3-beta', '1.2.3-rc', '1.2.3-rc.0', '1.2.3-rc.99', '1.2.3-rc.01', 'v1.2.3'])('rejects %s', (semver) => {
    expect(() => versionCode(semver)).toThrow();
    expect(() => appVersionCode(semver)).toThrow();
  });

  it('orders candidates before their final release and after the release before', () => {
    const order = ['0.2.0', '0.2.1', '0.3.0-rc.1', '0.3.0-rc.2', '0.3.0-rc.10', '0.3.0', '0.3.1-rc.1', '0.3.1', '1.0.0-rc.1'];
    const codes = order.map(versionCode);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('stays above every code of the old formula (MAJOR*10000 + MINOR*100 + PATCH), so 0.2.0 updates', () => {
    expect(versionCode('0.3.0-rc.1')).toBeGreaterThan(200);
  });

  it('agrees with the copy the app uses to compare releases', () => {
    for (const semver of ['0.0.1', '0.2.0', '0.3.0-rc.1', '1.2.3', '2.99.99', '10.0.0-rc.98']) expect(appVersionCode(semver)).toBe(versionCode(semver));
  });
});

describe('app config', () => {
  it('takes the version from package.json', () => {
    expect(config.version).toBe(version);
    expect(config.android?.versionCode).toBe(versionCode(version));
  });
});

describe('patchReleaseSigning', () => {
  const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            shrinkResources false
        }
    }
}`;

  it('signs release builds with the Edji key when the keystore is given, and keeps debug as is', () => {
    const out = patchReleaseSigning(TEMPLATE);
    expect(out).toContain("storeFile file(System.getenv('EDJI_KEYSTORE_FILE'))");
    expect(out).toMatch(/release \{\s*signingConfig System\.getenv\('EDJI_KEYSTORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug/);
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug/);
  });

  it('is idempotent', () => {
    const once = patchReleaseSigning(TEMPLATE);
    expect(patchReleaseSigning(once)).toBe(once);
  });

  it('fails loudly when the template changed', () => {
    expect(() => patchReleaseSigning('android { buildTypes { release { } } }')).toThrow('no longer matches');
  });
});

describe('permissions', () => {
  it('keeps the microphone for voice: the image picker plugin must not block RECORD_AUDIO', () => {
    expect(config.android?.permissions).toContain('android.permission.RECORD_AUDIO');
    const picker = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, Record<string, unknown>] | undefined;
    expect(picker).toBeDefined();
    expect(picker?.[1].microphonePermission).not.toBe(false);
  });
});
