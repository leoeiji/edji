import { version } from '../package.json';
import config, { patchReleaseSigning, versionCode } from '../app.config';
import { versionCode as appVersionCode } from '../src/core/version';

describe('versionCode', () => {
  it.each([
    ['0.0.1', 1],
    ['0.1.0', 100],
    ['1.2.3', 10203],
    ['2.99.99', 29999],
  ])('%s → %i', (semver, code) => {
    expect(versionCode(semver)).toBe(code);
  });

  it.each(['1.2', '1.100.0', '1.2.3-beta', 'v1.2.3'])('rejects %s', (semver) => {
    expect(() => versionCode(semver)).toThrow();
    expect(() => appVersionCode(semver)).toThrow();
  });

  it('agrees with the copy the app uses to compare releases', () => {
    for (const semver of ['0.0.1', '0.2.0', '1.2.3', '2.99.99', '10.0.0']) expect(appVersionCode(semver)).toBe(versionCode(semver));
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
