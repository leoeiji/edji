import { parseDeepLink } from '../deepLink';

describe('parseDeepLink', () => {
  it('reads screens, conversations and voice sessions', () => {
    expect(parseDeepLink('edji://settings')).toEqual({ kind: 'screen', screen: 'settings' });
    expect(parseDeepLink('edji://chat/12')).toEqual({ kind: 'conversation', id: 12 });
    expect(parseDeepLink('edji://chat/voice/3f2a-9c')).toEqual({ kind: 'voiceConversation', sessionId: '3f2a-9c' });
  });

  it('ignores other links', () => {
    expect(parseDeepLink('https://exemplo.com')).toBeNull();
    expect(parseDeepLink('edji://chat/abc/def')).toBeNull();
    expect(parseDeepLink(null)).toBeNull();
  });
});
