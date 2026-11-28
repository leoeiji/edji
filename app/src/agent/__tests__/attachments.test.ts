import {
  MAX_ATTACHMENTS,
  badgeOf,
  classify,
  formatSize,
  loadForModel,
  modelInputs,
  rejection,
  resolveMime,
  type Attachment,
  type AttachmentReader,
} from '../attachments';

const image: Attachment = { kind: 'image', uri: 'file:///a/cupom.jpg', name: 'cupom.jpg', mime: 'image/jpeg', size: 1000 };
const pdf: Attachment = { kind: 'file', uri: 'file:///a/fatura.pdf', name: 'fatura.pdf', mime: 'application/pdf', size: 2000 };
const csv: Attachment = { kind: 'file', uri: 'file:///a/gastos.csv', name: 'gastos.csv', mime: 'text/csv', size: 300 };

const reader: AttachmentReader = {
  base64: async (uri) => `b64:${uri}`,
  text: async (uri) => `texto:${uri}`,
};

describe('classify and resolveMime', () => {
  it('tells pictures, PDFs and text apart, and refuses the rest', () => {
    expect(classify('foto.jpg', 'image/jpeg')).toBe('image');
    expect(classify('fatura.pdf', 'application/pdf')).toBe('pdf');
    expect(classify('gastos.csv', 'text/csv')).toBe('text');
    expect(classify('dados.json', 'application/json')).toBe('text');
    expect(classify('notas.md', 'text/markdown')).toBe('text');
    expect(classify('planilha.xlsx', 'application/vnd.ms-excel')).toBe('unsupported');
    expect(classify('video.mp4', 'video/mp4')).toBe('unsupported');
  });

  it('falls back to the extension when the picker gives no useful type', () => {
    expect(resolveMime('fatura.PDF', undefined)).toBe('application/pdf');
    expect(resolveMime('gastos.csv', 'application/octet-stream')).toBe('text/csv');
    expect(resolveMime('foto.png', 'image/png')).toBe('image/png');
  });
});

describe('rejection', () => {
  it('accepts a normal file', () => {
    expect(rejection('fatura.pdf', 'application/pdf', 2_000_000, 0)).toBeNull();
  });

  it('refuses a fifth attachment, a big file, a big text and an unknown type, in Portuguese', () => {
    expect(rejection('a.pdf', 'application/pdf', 10, MAX_ATTACHMENTS)).toBe('No máximo 4 anexos por mensagem.');
    expect(rejection('grande.pdf', 'application/pdf', 11 * 1024 * 1024, 0)).toBe('"grande.pdf" passa de 10 MB.');
    expect(rejection('log.txt', 'text/plain', 300 * 1024, 0)).toContain('texto grande demais');
    expect(rejection('a.zip', 'application/zip', 10, 0)).toContain('"a.zip" não dá');
  });
});

describe('formatting', () => {
  it('shows sizes the way the cards do', () => {
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(340 * 1024)).toBe('340 KB');
    expect(formatSize(2.4 * 1024 * 1024)).toBe('2,4 MB');
  });

  it('badges a file by its extension', () => {
    expect(badgeOf('fatura-nov.pdf')).toBe('PDF');
    expect(badgeOf('semextensao')).toBe('ARQ');
  });
});

describe('loadForModel', () => {
  it('sends images and PDFs in full for the message being sent, and text as text', async () => {
    expect(await loadForModel([image, pdf, csv], reader, true)).toEqual([
      { type: 'image', name: 'cupom.jpg', mime: 'image/jpeg', data: 'b64:file:///a/cupom.jpg' },
      { type: 'pdf', name: 'fatura.pdf', mime: 'application/pdf', data: 'b64:file:///a/fatura.pdf' },
      { type: 'text', name: 'gastos.csv', text: 'texto:file:///a/gastos.csv' },
    ]);
  });

  it('keeps only the name of earlier images and PDFs, but still sends their text files', async () => {
    expect(await loadForModel([image, pdf, csv], reader, false)).toEqual([
      { type: 'omitted', name: 'cupom.jpg' },
      { type: 'omitted', name: 'fatura.pdf' },
      { type: 'text', name: 'gastos.csv', text: 'texto:file:///a/gastos.csv' },
    ]);
  });

  it('does not fail the turn when a file is gone', async () => {
    const broken: AttachmentReader = { base64: async () => Promise.reject(new Error('gone')), text: async () => Promise.reject(new Error('gone')) };
    expect(await loadForModel([image, csv], broken, true)).toEqual([
      { type: 'omitted', name: 'cupom.jpg' },
      { type: 'omitted', name: 'gastos.csv' },
    ]);
  });
});

describe('modelInputs', () => {
  const list = {
    data: [
      { id: 'a/visao', architecture: { input_modalities: ['text', 'image'] } },
      { id: 'a/texto', architecture: { input_modalities: ['text'] } },
      { id: 'a/sem-info' },
    ],
  };

  it('reads whether a model takes images from the OpenRouter list', async () => {
    expect(await modelInputs('a/visao', async () => list)).toEqual({ image: true });
    expect(await modelInputs('a/texto', async () => list)).toEqual({ image: false });
  });

  it('is null (let it through) when the model, its modalities or the list are unknown', async () => {
    expect(await modelInputs('a/outro', async () => list)).toBeNull();
    expect(await modelInputs('a/sem-info', async () => list)).toBeNull();
    expect(await modelInputs('a/visao', async () => Promise.reject(new Error('offline')))).toBeNull();
  });
});
