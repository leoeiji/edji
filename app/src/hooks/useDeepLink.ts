import { useEffect } from 'react';
import { Linking } from 'react-native';

/**
 * Calls [onOpen] with the screen named by an `edji://<screen>` link, on launch
 * and while the app is open. The voice session opens `edji://settings` when
 * the key or the model is missing.
 */
export function useDeepLink(onOpen: (screen: string) => void) {
  useEffect(() => {
    const open = (url: string | null | undefined) => {
      const screen = url?.match(/^edji:\/\/([\w-]+)/)?.[1];
      if (screen) onOpen(screen);
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [onOpen]);
}
