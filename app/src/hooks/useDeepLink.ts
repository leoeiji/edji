import { useEffect } from 'react';
import { Linking } from 'react-native';
import { parseDeepLink, type DeepLink } from '@/navigation/deepLink';

/**
 * Calls [onOpen] with each `edji://` link, on launch and while the app is
 * open. The voice session opens `edji://settings` when the key or the model
 * is missing, and `edji://chat/voice/<sessionId>` to continue in the app.
 */
export function useDeepLink(onOpen: (link: DeepLink) => void) {
  useEffect(() => {
    const open = (url: string | null | undefined) => {
      const link = parseDeepLink(url);
      if (link) onOpen(link);
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [onOpen]);
}
