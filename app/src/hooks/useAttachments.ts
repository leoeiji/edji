import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOpenRouterModels } from '@/agent/openrouter';
import { IMAGE_MAX_SIDE, MAX_ATTACHMENTS, classify, modelInputs, rejection, resolveMime, type Attachment } from '@/agent/attachments';
import { loadModelSettings } from '@/agent/settings';
import { fileSize, removeAttachments, storeFile } from '@/core/attachmentFiles';

/** What the composer needs to add, show and drop attachments of the message being written. */
export type AttachmentsState = {
  items: Attachment[];
  /** Why something could not be added; cleared on the next add or removal. */
  error: string | null;
  /** The model that cannot read the images, when there are images and the model is known not to. */
  blockedModel: string | null;
  takePhoto(): Promise<void>;
  pickImages(): Promise<void>;
  pickFiles(): Promise<void>;
  remove(item: Attachment): void;
  /** Hands the items over for sending and empties the list without deleting their files. */
  take(): Attachment[];
};

/**
 * The attachments of the message being written (ADR 0009). Every file is
 * copied into the app as soon as it is picked (images shrunk first), so the
 * message can be sent later and the original may disappear. Items the user
 * removes are deleted; sent ones belong to the conversation.
 */
export function useAttachments(): AttachmentsState {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blockedModel, setBlockedModel] = useState<string | null>(null);
  const current = useRef(items);
  current.current = items;

  const hasImage = items.some((a) => a.kind === 'image');
  useEffect(() => {
    if (!hasImage) return setBlockedModel(null);
    let alive = true;
    (async () => {
      const { model } = await loadModelSettings();
      const inputs = model ? await modelInputs(model, fetchOpenRouterModels) : null;
      if (alive) setBlockedModel(model && inputs && !inputs.image ? model : null);
    })();
    return () => {
      alive = false;
    };
  }, [hasImage]);

  const add = useCallback(async (picked: Attachment[]) => {
    if (picked.length) setItems((list) => [...list, ...picked]);
  }, []);

  const takePhoto = useCallback(async () => {
    setError(null);
    if (current.current.length >= MAX_ATTACHMENTS) return setError(rejection('', '', 0, current.current.length));
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return setError('Sem permissão da câmera. Libere em Permissões.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) await add(await importImages(result.assets, current.current.length, setError));
  }, [add]);

  const pickImages = useCallback(async () => {
    setError(null);
    const room = MAX_ATTACHMENTS - current.current.length;
    if (room <= 0) return setError(rejection('', '', 0, current.current.length));
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 1,
    });
    if (!result.canceled) await add(await importImages(result.assets, current.current.length, setError));
  }, [add]);

  const pickFiles = useCallback(async () => {
    setError(null);
    if (current.current.length >= MAX_ATTACHMENTS) return setError(rejection('', '', 0, current.current.length));
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/*', 'application/json'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const picked: Attachment[] = [];
    for (const asset of result.assets) {
      const mime = resolveMime(asset.name, asset.mimeType);
      const size = asset.size ?? (await fileSize(asset.uri));
      const why = rejection(asset.name, mime, size, current.current.length + picked.length);
      if (why) {
        setError(why);
        continue;
      }
      const kind = classify(asset.name, mime) === 'image' ? 'image' : 'file';
      picked.push({ kind, uri: await storeFile(asset.uri, asset.name), name: asset.name, mime, size });
    }
    await add(picked);
  }, [add]);

  const remove = useCallback((item: Attachment) => {
    setError(null);
    setItems((list) => list.filter((a) => a.uri !== item.uri));
    removeAttachments([item]).catch(() => {});
  }, []);

  const take = useCallback(() => {
    const taken = current.current;
    current.current = [];
    setItems([]);
    setError(null);
    return taken;
  }, []);

  return { items, error, blockedModel, takePhoto, pickImages, pickFiles, remove, take };
}

/** Shrinks each picked image (longest side [IMAGE_MAX_SIDE], JPEG) and stores the copy. */
async function importImages(assets: ImagePicker.ImagePickerAsset[], already: number, onError: (message: string) => void): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const asset of assets) {
    const base = (asset.fileName ?? 'foto').replace(/\.[^.]+$/, '');
    const name = `${base}.jpg`;
    const why = rejection(name, 'image/jpeg', 0, already + out.length);
    if (why) {
      onError(why);
      break;
    }
    try {
      const long = Math.max(asset.width, asset.height);
      const actions = long > IMAGE_MAX_SIDE ? [{ resize: asset.width >= asset.height ? { width: IMAGE_MAX_SIDE } : { height: IMAGE_MAX_SIDE } }] : [];
      const shrunk = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
      const uri = await storeFile(shrunk.uri, name);
      out.push({ kind: 'image', uri, name, mime: 'image/jpeg', size: await fileSize(uri) });
    } catch {
      onError(`Não consegui abrir "${name}".`);
    }
  }
  return out;
}
