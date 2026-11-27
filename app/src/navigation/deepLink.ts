/** Where an `edji://` link leads. */
export type DeepLink =
  | { kind: 'screen'; screen: string }
  | { kind: 'conversation'; id: number }
  | { kind: 'voiceConversation'; sessionId: string };

/**
 * Reads an `edji://` link: `edji://<screen>`, `edji://chat/<id>` or
 * `edji://chat/voice/<sessionId>` (the voice session's "Abrir no Edji").
 * Anything else is null.
 */
export function parseDeepLink(url: string | null | undefined): DeepLink | null {
  const path = url?.match(/^edji:\/\/([^?#]*)/)?.[1]?.replace(/\/+$/, '');
  if (!path) return null;
  const voice = path.match(/^chat\/voice\/([\w-]+)$/);
  if (voice) return { kind: 'voiceConversation', sessionId: voice[1] };
  const chat = path.match(/^chat\/(\d+)$/);
  if (chat) return { kind: 'conversation', id: Number(chat[1]) };
  if (/^[\w-]+$/.test(path)) return { kind: 'screen', screen: path };
  return null;
}
