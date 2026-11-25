import { version } from '../package.json';
import config, { versionCode } from '../app.config';

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
  });
});

describe('app config', () => {
  it('takes the version from package.json', () => {
    expect(config.version).toBe(version);
    expect(config.android?.versionCode).toBe(versionCode(version));
  });
});
