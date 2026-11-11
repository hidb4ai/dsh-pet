/**
 * Common layers of settings page scripts: tokens, request encapsulation, shared state, and DOM tools.
 *
 * The first fragment as a full-page script is spelled into the same IIFE, and subsequent fragments only call the name
 * exported here. The token is only stored in the memory and sent out with the request header, and the copy in the
 * address bar is cleared after reading it; when there is no token in the memory after the refresh, the HttpOnly cookie
 * exchanged for the first visit will continue to be authenticated, so the request will always be issued based on the
 * same source credentials. The second enumeration list is not allowed to appear in the fragment, and the values are
 * always injected by the caller.
 * @module dsh-pet/src/standalone/settings-page/script/core
 */

/** The enumerations and default values required by the script fragment are all injected from source code constants by the assembly entry point. */
export interface ScriptConsts {
  /** Tone whitelist (from host/voice/voices.ts). */
  readonly voices: readonly { readonly id: string; readonly name: string; readonly tag: string }[];
  /** Font preset id (from shared/fonts.ts). */
  readonly fonts: readonly string[];
  /** Display file (from shared/config.ts). */
  readonly displays: readonly string[];
  /** Dock corner (from host/config/constants.ts). */
  readonly corners: readonly string[];
  /** Physical default (from shared/physics). */
  readonly physics: unknown;
  /** Font default (from shared/fonts.ts). */
  readonly font: unknown;
  /** Default value of action frequency (from shared/weights.ts). */
  readonly weights: unknown;
}

/**
 * Generating common layer fragments.
 *
 * @param routePath - Plugin HTTP prefix, taken from shared/constants's ROUTE_SEGMENT.
 * @param consts - Enumerations and default values.
 * @returns can directly insert the source code of the full page script.
 */
export function coreScript(routePath: string, consts: ScriptConsts): string {
  return `
const TOKEN = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', location.pathname);
const API = ${JSON.stringify(routePath)};
const VOICES = ${JSON.stringify(consts.voices)};
const FONT_IDS = ${JSON.stringify(consts.fonts)};
const DISPLAYS = ${JSON.stringify(consts.displays)};
const CORNERS = ${JSON.stringify(consts.corners)};
const FALLBACK_PHYSICS = ${JSON.stringify(consts.physics)};
const FALLBACK_FONT = ${JSON.stringify(consts.font)};
const FALLBACK_WEIGHTS = ${JSON.stringify(consts.weights)};
const FALLBACK_INTERVAL_SEC = 300;
const state = { config: null, meta: null, globals: null, pets: {}, prompts: {}, entry: 'main', petIndex: 0, dirty: false };

function byId(id) {
  return document.getElementById(id);
}

function make(tag, props, kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = value === true;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    }
  }
  if (kids) {
    for (const kid of kids) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  return node;
}

function setStatus(node, text, kind) {
  if (!node) return;
  node.textContent = text;
  node.dataset.error = kind === 'error' ? 'true' : 'false';
  node.dataset.ok = kind === 'ok' ? 'true' : 'false';
}

function markDirty(value) {
  state.dirty = value;
  const badge = byId('dirty');
  if (badge) badge.hidden = !value;
}

async function callApi(method, path, body) {
  const response = await fetch(API + path, {
    method: method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' }
      : { 'X-DSH-Pet-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 403) throw new Error('打开凭据已失效，请从桌宠菜单重新打开设置。');
    if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
    throw new Error((data && (data.message || data.error)) || '本机接口暂时无法处理请求');
  }
  return data;
}
`;
}
