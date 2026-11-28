/**
 * Attachments of a chat message (ADR 0009): images and files the user adds
 * before sending. The bytes live in a file of the app; the database keeps
 * the pointer and the facts below. Pure logic here, no file or UI access.
 */

/** What the chat stores and shows about an attachment. */
export type Attachment = {
  /** `image` is shown as a picture, `file` as a card. */
  kind: 'image' | 'file';
  uri: string;
  name: string;
  mime: string;
  size: number;
};

/** An attachment as a stored message part. */
export type AttachmentPart = { type: 'attachment' } & Attachment;

/** Most attachments in one message. */
export const MAX_ATTACHMENTS = 4;
/** Largest file the user can add, in bytes. Images are shrunk well below this before they are stored. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Largest text file: it goes into the prompt as text, so it counts as tokens. */
export const MAX_TEXT_BYTES = 200 * 1024;
/** Longest side of a stored image, in pixels. */
export const IMAGE_MAX_SIDE = 1600;

const TEXT_TYPES = new Set(['application/json', 'application/csv', 'text/csv', 'text/markdown', 'text/plain']);
const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'json', 'md', 'log']);
const EXTENSION_MIME: Record<string, string> = {
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  md: 'text/markdown',
  log: 'text/plain',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** What a file is for the chat: a picture, a PDF, a text read into the prompt, or not accepted. */
export type AttachmentClass = 'image' | 'pdf' | 'text' | 'unsupported';

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The media type to trust: the picker's when it is specific, else the one the extension says. */
export function resolveMime(name: string, mime: string | null | undefined): string {
  const given = mime?.trim().toLowerCase();
  if (given && given !== 'application/octet-stream') return given;
  return EXTENSION_MIME[extensionOf(name)] ?? given ?? 'application/octet-stream';
}

export function classify(name: string, mime: string): AttachmentClass {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (TEXT_TYPES.has(m) || (m.startsWith('text/') && TEXT_EXTENSIONS.has(extensionOf(name)))) return 'text';
  return 'unsupported';
}

/** The reason a file cannot be added, in the app's tone, or null when it can. */
export function rejection(name: string, mime: string, size: number, alreadyAdded: number): string | null {
  if (alreadyAdded >= MAX_ATTACHMENTS) return `No máximo ${MAX_ATTACHMENTS} anexos por mensagem.`;
  const kind = classify(name, mime);
  if (kind === 'unsupported') return `O Edji lê imagens, PDF e texto (TXT, CSV, JSON, MD). "${name}" não dá.`;
  if (size > MAX_ATTACHMENT_BYTES) return `"${name}" passa de 10 MB.`;
  if (kind === 'text' && size > MAX_TEXT_BYTES) return `"${name}" é um texto grande demais (máximo 200 KB).`;
  return null;
}

/** "340 KB", "2,4 MB": the size as the cards show it. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Short label for the file card: the extension in capitals, `ARQ` when there is none. */
export function badgeOf(name: string): string {
  const ext = extensionOf(name);
  return ext && ext.length <= 4 ? ext.toUpperCase() : 'ARQ';
}

/** An attachment as the model receives it. Read from the stored file just before the request. */
export type ModelAttachment =
  | { type: 'image'; name: string; mime: string; data: string }
  | { type: 'pdf'; name: string; mime: string; data: string }
  | { type: 'text'; name: string; text: string }
  /** Sent in an earlier turn (or no longer readable): only its name goes back, so the images are not paid for again. */
  | { type: 'omitted'; name: string };

/** Reads the stored file; injected, so this module needs no file system. */
export type AttachmentReader = {
  base64(uri: string): Promise<string>;
  text(uri: string): Promise<string>;
};

/**
 * Loads the attachments of a message for the model. Text files always go in
 * full (they are small and cheap); images and PDFs only when [full] is true,
 * which is the message being sent now. A file that cannot be read becomes
 * `omitted` instead of failing the turn.
 */
export async function loadForModel(attachments: Attachment[], reader: AttachmentReader, full: boolean): Promise<ModelAttachment[]> {
  const out: ModelAttachment[] = [];
  for (const a of attachments) {
    const kind = classify(a.name, a.mime);
    try {
      if (kind === 'text') out.push({ type: 'text', name: a.name, text: await reader.text(a.uri) });
      else if (kind === 'image' && full) out.push({ type: 'image', name: a.name, mime: a.mime, data: await reader.base64(a.uri) });
      else if (kind === 'pdf' && full) out.push({ type: 'pdf', name: a.name, mime: a.mime, data: await reader.base64(a.uri) });
      else out.push({ type: 'omitted', name: a.name });
    } catch {
      out.push({ type: 'omitted', name: a.name });
    }
  }
  return out;
}

/** What OpenRouter says a model accepts as input. */
export type ModelInputs = { image: boolean };

type ModelsResponse = { data?: { id?: string; architecture?: { input_modalities?: string[] } }[] };

/**
 * Whether [model] reads images, from OpenRouter's public model list (no key,
 * no user data; it only reveals the IP, like the update check). `null` when
 * the list cannot be had or does not know the model, so the caller lets the
 * attachment through and the provider has the last word.
 */
export async function modelInputs(model: string, fetchModels: () => Promise<unknown>): Promise<ModelInputs | null> {
  try {
    const body = (await fetchModels()) as ModelsResponse;
    const found = body.data?.find((m) => m.id === model);
    const modalities = found?.architecture?.input_modalities;
    return modalities ? { image: modalities.includes('image') } : null;
  } catch {
    return null;
  }
}

/** The one-line text that tells the model what an attachment was, when it cannot see it any more. */
export function omittedNote(name: string): string {
  return `[Anexo enviado antes: ${name}]`;
}
