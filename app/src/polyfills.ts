/**
 * Globals the AI SDK needs that Hermes lacks. Imported first in `index.ts`, so
 * both the app and the headless voice task get them.
 */
import { Platform } from 'react-native';
// @ts-expect-error: internal React Native helper without type declarations.
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions';
import structuredClone from '@ungap/structured-clone';
import { TextDecoderStream, TextEncoderStream } from '@stardazed/streams-text-encoding';

if (Platform.OS !== 'web') {
  if (!('structuredClone' in globalThis)) polyfillGlobal('structuredClone', () => structuredClone);
  polyfillGlobal('TextEncoderStream', () => TextEncoderStream);
  polyfillGlobal('TextDecoderStream', () => TextDecoderStream);
}
