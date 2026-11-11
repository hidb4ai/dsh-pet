/**
 * The contract test of the avatar fragment: the generated script is run, not the source text.
 *
 * Use vm to provide the smallest DOM stand-in (make/FileReader/canvas/createImageBitmap/URL), assertion "what is
 * requested, where to send it, and how to display failure". The avatar cannot be directly inserted into img src (the
 * same source as img without Origin will be judged as the file source), so here we also verify "first bring the token
 * fetch and then transfer to blob". Running method: node --experimental-strip-types --test
 * src/standalone/settings-page/script/avatar.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { AVATAR_MAX_SIDE_PX as CLIENT_AVATAR_MAX_SIDE_PX } from '../../../client/settings/avatar-upload.ts';
import { AVATAR_MAX_SIDE_PX } from '../../settings-page.ts';
import { avatarScript } from './avatar.ts';

const LOGO = '/dsh-pet-7340/logo';
const API = '/dsh-pet-7340';

type FakeNode = {
  tag: string;
  props: Record<string, unknown>;
  children: FakeNode[];
  listeners: Record<string, (event?: unknown) => void>;
  textContent: string;
  dataset: Record<string, string>;
  src: string;
  value: string;
  files: unknown[];
  hidden: boolean;
  append(...kids: FakeNode[]): void;
  addEventListener(name: string, fn: (event?: unknown) => void): void;
  setAttribute(name: string, value: string): void;
  click(): void;
};

/** Minimal stand-in with the same semantics as make in the page: only implements the attributes used in this fragment. */
function make(tag: string, props?: Record<string, unknown>, kids?: FakeNode[]): FakeNode {
  const node: FakeNode = {
    tag,
    props: props ?? {},
    children: [],
    listeners: {},
    textContent: '',
    dataset: {},
    src: '',
    value: '',
    files: [],
    hidden: false,
    append(...items) {
      node.children.push(...items);
    },
    addEventListener(name, fn) {
      node.listeners[name] = fn;
    },
    setAttribute(name, value) {
      node.props[name] = value;
    },
    click() {
      node.listeners.click?.();
    },
  };
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'text') node.textContent = String(value);
    else if (key === 'hidden') node.hidden = value === true;
    else if (key === 'value') node.value = String(value);
  }
  if (kids) node.children.push(...kids);
  return node;
}

/** A recorded request. */
type Recorded = { url: string; method: string; headers: Record<string, string>; body: string };

/** Create a driveable context; fetch records the request, GET returns the bytes, and POST returns the given response. */
function harness(options: { width?: number; height?: number; reply?: unknown } = {}) {
  const requests: Recorded[] = [];
  const reply = options.reply ?? { ok: true };
  let blobs = 0;
  const context: Record<string, unknown> = {
    API,
    TOKEN: 'test-token',
    state: { entry: 'shuai', petIndex: 0 },
    make,
    setStatus(node: FakeNode, text: string, kind?: string) {
      node.textContent = text;
      node.dataset.kind = kind ?? '';
    },
    encodeURIComponent,
    JSON,
    Math,
    String,
    Date,
    Promise,
    Error,
    URL: {
      createObjectURL: () => 'blob:avatar-' + (blobs += 1),
      revokeObjectURL() {},
    },
    fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      requests.push({
        url,
        method: init?.method ?? 'GET',
        headers: init?.headers ?? {},
        body: init?.body ?? '',
      });
      if (url.includes('/pet-avatar?')) return { ok: true, status: 200, json: async () => reply };
      return { ok: true, status: 200, blob: async () => ({ size: 1 }) };
    },
    createImageBitmap: async () => ({ width: options.width ?? 100, height: options.height ?? 100 }),
    FileReader: class {
      result = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: { base64: string }) {
        this.result = 'data:image/png;base64,' + file.base64;
        queueMicrotask(() => this.onload?.());
      }
    },
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/png;base64,SCALED',
      }),
    },
  };
  runInNewContext(avatarScript({ logoUrl: LOGO, maxSide: AVATAR_MAX_SIDE_PX }), context);
  return { context, requests };
}

/** Wait for two rounds of event loops: preview capture and upload are both asynchronous. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** Remove the hidden file input from the row (it is in . avatarBox, not at the row root). */
function fileInput(row: FakeNode): FakeNode {
  const box = row.children.find((child) => child.props.class === 'avatarBox');
  const input = box?.children.find((child) => child.props.type === 'file');
  assert.ok(input, 'Entries with changeable avatars must contain hidden file input');
  return input;
}

/** Trigger image selection once and wait for the upload to be finalized. */
async function pick(input: FakeNode, file: unknown): Promise<void> {
  input.files = [file];
  input.listeners.change?.();
  await settle();
}

test('Built-in entry: Preview is still displayed, but there is no upload button', async () => {
  const { context, requests } = harness();
  (context.state as { entry: string }).entry = 'main';
  const row = (context.avatarRow as (pet: Record<string, never>) => FakeNode)({});
  await settle();
  assert.match(
    requests[0].url,
    /^\/dsh-pet-7340\/logo\?v=\d+$/,
    'The built-in entry is logo in the package, without root',
  );
  assert.equal(
    requests[0].headers['X-DSH-Pet-Token'],
    'test-token',
    'You must bring a token when taking pictures, otherwise the packaged version will be 403',
  );
  assert.match(
    row.children[0].src,
    /^blob:avatar-/,
    'Preview blob without inserting the address directly into img src',
  );
  const box = row.children.find((child) => child.props.class === 'avatarBox');
  assert.ok(box);
  assert.equal(
    box.children.some((child) => child.props.type === 'file'),
    false,
    'File selection box must not appear for built-in entries',
  );
  assert.equal(
    box.children.some((child) => child.textContent === '上传头像'),
    false,
    'The upload button must not appear for built-in entries',
  );
});

test('Asset root entry: The entry name is the asset root, and the image acquisition address contains root and version number.', async () => {
  const { context, requests } = harness();
  (context.avatarRow as (pet: Record<string, never>) => FakeNode)({});
  await settle();
  assert.match(
    requests[0].url,
    /^\/dsh-pet-7340\/logo\?root=shuai&v=\d+$/,
    'When there is no assetRoot in / config, use the entry name',
  );
});

test('The long side is within the upper limit: Upload the original image bytes as it is, request with a token, and retrieve the preview after success.', async () => {
  const { context, requests } = harness({ width: 400, height: 300 });
  const row = (context.avatarRow as (pet: Record<string, never>) => FakeNode)({});
  await settle();
  const before = requests[0].url;
  await pick(fileInput(row), { base64: 'ORIGINAL' });
  const upload = requests.find((request) => request.url.includes('/pet-avatar?'));
  assert.ok(upload, 'An upload request must be issued');
  assert.equal(upload.method, 'POST');
  assert.equal(upload.url, API + '/pet-avatar?root=shuai', 'The upload parameter is root (asset root), not pet');
  assert.equal(upload.headers['X-DSH-Pet-Token'], 'test-token');
  assert.deepEqual(JSON.parse(upload.body), { base64: 'ORIGINAL' });
  const refetch = requests.filter((request) => request.url.startsWith(LOGO)).pop();
  assert.ok(refetch, 'Image must be taken again after uploading successfully');
  assert.notEqual(refetch.url, before, 'The version number must be changed when re-fetching');
});

test('Exceeding the upper limit of the long side: shrink the side first and then upload PNG', async () => {
  const { context, requests } = harness({ width: 1200, height: 800 });
  const row = (context.avatarRow as (pet: Record<string, never>) => FakeNode)({});
  await settle();
  await pick(fileInput(row), { base64: 'ORIGINAL' });
  const upload = requests.find((request) => request.url.includes('/pet-avatar?'));
  assert.ok(upload);
  assert.deepEqual(JSON.parse(upload.body), { base64: 'SCALED' });
});

test('Server rejection: display its copy as is', async () => {
  const { context } = harness({ reply: { ok: false, message: '只支持 PNG / JPEG / WebP / GIF' } });
  const row = (context.avatarRow as (pet: Record<string, never>) => FakeNode)({});
  await settle();
  const box = row.children.find((child) => child.props.class === 'avatarBox');
  assert.ok(box);
  const status = box.children[box.children.length - 1];
  await pick(fileInput(row), { base64: 'ORIGINAL' });
  assert.equal(status.textContent, '只支持 PNG / JPEG / WebP / GIF');
  assert.equal(status.dataset.kind, 'error');
});

test('The long side limit of page injection is consistent with the plugin client', () => {
  assert.equal(
    AVATAR_MAX_SIDE_PX,
    CLIENT_AVATAR_MAX_SIDE_PX,
    'Inconsistency between the two upper limits will cause the page to shrink more or less than the backend allows.',
  );
});
