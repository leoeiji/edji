/**
 * Android versionCode from a MAJOR.MINOR.PATCH version: MAJOR*10000 + MINOR*100 + PATCH,
 * so each release installs over the previous one. MINOR and PATCH go up to 99.
 * Copy of the one in `app.config.ts`, which builds the app; `appUpdate.ts` uses
 * this one to compare a release tag with the installed app.
 */
export function versionCode(semver: string): number {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(semver);
  if (!match) throw new Error(`Version "${semver}" must be MAJOR.MINOR.PATCH, with MINOR and PATCH up to 99`);
  const [major, minor, patch] = match.slice(1).map(Number);
  return major * 10000 + minor * 100 + patch;
}
