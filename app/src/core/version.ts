const MAX_RC = 98;
/** The last digits of a final release, above any of its candidates. */
const FINAL = 99;

/**
 * Android versionCode from MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N (ADR 0007):
 * MAJOR*1_000_000 + MINOR*10_000 + PATCH*100 + N, with 99 for the final release,
 * so each release candidate installs over the one before and the final over its
 * candidates. MINOR and PATCH go up to 99, N from 1 to 98.
 * Copy of the one in `app.config.ts`, which builds the app; `appUpdate.ts` uses
 * this one to compare a release tag with the installed app.
 */
export function versionCode(semver: string): number {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})(?:-rc\.([1-9]\d?))?$/.exec(semver);
  const candidate = match?.[4] === undefined ? null : Number(match[4]);
  if (!match || (candidate !== null && candidate > MAX_RC)) {
    throw new Error(`Version "${semver}" must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N, with MINOR and PATCH up to 99 and N up to ${MAX_RC}`);
  }
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  return major * 1_000_000 + minor * 10_000 + patch * 100 + (candidate ?? FINAL);
}
