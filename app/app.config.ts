import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins';
import type { ExpoConfig } from 'expo/config';
import { version } from './package.json';

/**
 * Android versionCode from a MAJOR.MINOR.PATCH version: MAJOR*10000 + MINOR*100 + PATCH,
 * so each release installs over the previous one. MINOR and PATCH go up to 99.
 * The app has a copy in `src/core/version.ts` (Expo's config loader can't import
 * local TypeScript); `__tests__/app.config.test.ts` keeps both in agreement.
 */
export function versionCode(semver: string): number {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(semver);
  if (!match) throw new Error(`Version "${semver}" must be MAJOR.MINOR.PATCH, with MINOR and PATCH up to 99`);
  const [major, minor, patch] = match.slice(1).map(Number);
  return major * 10000 + minor * 100 + patch;
}

/**
 * Signs release builds with the Edji key when `EDJI_KEYSTORE_FILE` is set
 * (the release workflow sets it from GitHub secrets), else with the template's
 * debug key, as before. In-app updates (ADR 0007) rely on every release having
 * the same private key: Android only installs an update signed like the app.
 * Fails the prebuild if the template changed and the patch no longer applies.
 */
export const withReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = patchReleaseSigning(c.modResults.contents);
    return c;
  });

const RELEASE_SIGNING = `signingConfigs {
        release {
            if (System.getenv('EDJI_KEYSTORE_FILE')) {
                storeFile file(System.getenv('EDJI_KEYSTORE_FILE'))
                storePassword System.getenv('EDJI_KEYSTORE_PASSWORD')
                keyAlias System.getenv('EDJI_KEY_ALIAS')
                keyPassword System.getenv('EDJI_KEYSTORE_PASSWORD')
            }
        }`;

/** The template's app/build.gradle with the Edji release signing. Idempotent. */
export function patchReleaseSigning(gradle: string): string {
  if (gradle.includes('EDJI_KEYSTORE_FILE')) return gradle;
  const releaseUsesDebug = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!gradle.includes('signingConfigs {') || !releaseUsesDebug.test(gradle)) {
    throw new Error('withReleaseSigning: app/build.gradle no longer matches the Expo template; update the patch');
  }
  return gradle
    .replace('signingConfigs {', RELEASE_SIGNING)
    .replace(releaseUsesDebug, "$1signingConfig System.getenv('EDJI_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug");
}

/** Expo config. The version comes from package.json, the single source: bump it with `npm version`. */
const config: ExpoConfig = {
  name: 'Edji',
  slug: 'edji',
  version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: 'edji',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.edji.app',
  },
  android: {
    package: 'dev.edji.app',
    versionCode: versionCode(version),
    adaptiveIcon: {
      backgroundColor: '#073E2B',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.RECORD_AUDIO'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-sqlite', 'expo-secure-store'],
};

export default withReleaseSigning(config);
