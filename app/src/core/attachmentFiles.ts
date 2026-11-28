import * as FileSystem from 'expo-file-system/legacy';
import type { Attachment, AttachmentReader } from '@/agent/attachments';

/**
 * Where attached files live: a folder of the app that the system never
 * clears on its own (the cache could be). Files are removed with the
 * conversation that holds them, or when the user drops them before sending.
 */
const FOLDER = 'attachments/';

/** Safe file name: the extension is kept, everything odd becomes `-`. */
export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'arquivo';
}

/** Copies [source] into the attachments folder and returns the stored copy's uri. */
export async function storeFile(source: string, name: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}${FOLDER}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const to = `${dir}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(name)}`;
  await FileSystem.copyAsync({ from: source, to });
  return to;
}

/** Size in bytes of the file at [uri], or 0 when it is gone. */
export async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && 'size' in info ? info.size : 0;
}

/** Deletes files, ignoring the ones already gone. Never throws: a leftover file is not worth failing a delete. */
export async function removeFiles(uris: string[]): Promise<void> {
  await Promise.all(uris.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
}

/** Reads stored files for the model. */
export const attachmentReader: AttachmentReader = {
  base64: (uri) => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }),
  text: (uri) => FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 }),
};

/** Removes the stored copies of [attachments] (the user took them off before sending). */
export function removeAttachments(attachments: Attachment[]): Promise<void> {
  return removeFiles(attachments.map((a) => a.uri));
}
