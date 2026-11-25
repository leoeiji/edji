import type { ExpoConfig } from 'expo/config';
import { version } from './package.json';

/**
 * Android versionCode from a MAJOR.MINOR.PATCH version: MAJOR*10000 + MINOR*100 + PATCH,
 * so each release installs over the previous one. MINOR and PATCH go up to 99.
 */
export function versionCode(semver: string): number {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(semver);
  if (!match) throw new Error(`Version "${semver}" must be MAJOR.MINOR.PATCH, with MINOR and PATCH up to 99`);
  const [major, minor, patch] = match.slice(1).map(Number);
  return major * 10000 + minor * 100 + patch;
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

export default config;
