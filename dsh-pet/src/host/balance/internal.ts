/**
 * Internal tool for balance retrieval (host side): network policy, response verification and amount processing.
 *
 * Only used by ./providers /*. It does not contain the knowledge of the service provider and is not responsible for
 * register and route. Unified 20 s timeout plus 3 retries: Most of the target endpoints are overseas, and the actual
 * test will time out intermittently. Depends on the global fetch; always true: if a required field is missing or
 * invalid, an error will be thrown, and it will never be silently set to 0.
 *
 * @module dsh-pet/src/host/balance/internal
 */

/** Single crawl timeout (ms). */
const FETCH_TIMEOUT_MS = 20_000;
/** Number of retries after a single crawl failure (interval 0.8 s). */
const RETRIES = 3;

/** Initiate a fetch with timeout; if it fails, an error is thrown. Whether to retry is decided by the caller. */
async function fetchOnce(url: string, key: string): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'dsh-pet-balance' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/** Fetch with retries; throw last error when all fails. */
export async function fetchWithRetry(url: string, key: string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      return await fetchOnce(url, key);
    } catch (e) {
      last = e;
      if (i < RETRIES) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Required value: an error is thrown when it cannot be digitized or is not a finite number, and will be set to 0 if it is not silent. */
export function num(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('dsh-pet: invalid balance field ' + what);
  return n;
}

/** Required character string: passed only if it is not empty, otherwise an error will be thrown. */
export function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('dsh-pet: invalid balance field ' + what);
  return value;
}

/** Optional value: undefined is returned when missing, empty or invalid (required fields use num). */
export function looseNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Get ordinary objects: non-object, array or null and return undefined. */
export function obj(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Normalized reset time: The character string is returned as it is, and the digital timestamp automatically recognizes
 * seconds/milliseconds.
 * 0. Negative and invalid values return undefined - resetAt of the idle window in the message: 0 is a placeholder, not
 * 1970.
 */
function resetTime(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  const n = looseNum(value);
  if (n === undefined || n <= 0) return undefined;
  const ms = n < 1_000_000_000_000 ? n * 1000 : n; // 1 e12 Timestamps below are in seconds and above are in milliseconds
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Parse limit window; when the form is not recognized, undefined is returned and the window is treated as not existing. */
export function readWindow(value: unknown): { percent: number; capUsd: number; resetsAt?: string } | undefined {
  const w = obj(value);
  if (!w) return undefined;
  const used = looseNum(w.used);
  const cap = looseNum(w.cap);
  if (used === undefined || cap === undefined || cap <= 0) return undefined;
  // The lower bound is clamped to 0: the negative usage is meaningless and is read as unconsumed; the upper bound is not clamped, and the excess is reported as >100%.
  return { percent: Math.max(0, (used / cap) * 100), capUsd: cap, resetsAt: resetTime(w.resetAt) };
}

/** Query string spelling: skip undefined parameters (for example, orgId that cannot be retrieved will not be filled with null values). */
export function queryString(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
  return pairs.length > 0 ? '?' + pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
}

/**
 * The account amount converges to two decimal places. Character string: The platform returns the original string that
 * retains the accuracy of the server (such as `9.9902690000000000` ). Direct display will be inconsistent with the
 * `¥8.79` style of the official route; invalid values will still throw an error and do not forge 0.
 */
export function money(value: unknown, what: string): string {
  const raw = str(value, what);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error('dsh-pet: invalid account balance amount ' + what);
  return n.toFixed(2);
}

/**
 * When two amount strings are added, two decimal places are retained after calculation as integer points to avoid
 * binary floating point errors from appearing in the amount.
 */
export function sumMoney(a: string, b: string): string {
  return ((Math.round(Number(a) * 100) + Math.round(Number(b) * 100)) / 100).toFixed(2);
}
