import { keyboardInset } from '../useKeyboardInset';

describe('keyboardInset', () => {
  it('uses the reported height on Android, which already leaves out the navigation bar', () => {
    expect(keyboardInset('android', 300, 48)).toBe(300);
  });

  it('takes the home indicator off on iOS, since the safe area already pads it', () => {
    expect(keyboardInset('ios', 336, 34)).toBe(302);
  });

  it('is zero with the keyboard closed', () => {
    expect(keyboardInset('android', 0, 48)).toBe(0);
  });
});
