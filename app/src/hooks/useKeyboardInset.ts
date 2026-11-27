import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How much of the bottom of the screen the keyboard covers, for a screen
 * inside the app's `SafeAreaView`. `KeyboardAvoidingView` doesn't work here:
 * with edge-to-edge on, Android no longer resizes the window, and
 * `keyboardDidShow` reports the keyboard top (`screenY`) at the bottom of the
 * screen. The height is right, though: React Native reports it without the
 * navigation bar, which the safe area already pads. On iOS the height
 * includes the home indicator area, so the inset comes off.
 */
export function useKeyboardInset(): number {
  const { bottom } = useSafeAreaInsets();
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e: KeyboardEvent) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return keyboardInset(Platform.OS, height, bottom);
}

/** The padding that keeps content above a keyboard of [height], given the safe-area [bottomInset]. */
export function keyboardInset(platform: string, height: number, bottomInset: number): number {
  if (height <= 0) return 0;
  return Math.max(0, platform === 'ios' ? height - bottomInset : height);
}
