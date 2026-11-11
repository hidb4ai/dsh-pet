/**
 * Target extraction: Extract "what is being operated on" from the tool parameters or command line, and centralize the
 * length.
 *
 * It only parses, not renders; if it cannot be parsed, it returns undefined, falling back from the upper layer to the
 * atmospheric sentence. This must always be true: the command only looks at the command name and parameter shape, and
 * parameter values are not included in the bubble.
 * @module dsh-pet/src/host/tool-detail/target
 */
import { TASK_TEXT_MAX } from '../work-status.ts';
import type { CopyLine } from './copy.ts';

/** Non-empty character string (remove leading and trailing blanks), otherwise null - all parameters are passed through it first. */
export function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Take the first non-empty character string in candidate order: the field names of tools with the same name may be different in different versions (file_path / filePath / path). */
export function firstStr(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = str(args[key]);
    if (value !== null) return value;
  }
  return null;
}

/** File tools: `file_path` is the mainstream, and `path` is the writing method of some tools. */
export function fileTarget(args: Record<string, unknown>): string | null {
  return firstStr(args, ['file_path', 'filePath', 'path']);
}

/** Web page: It is enough to give the host name (the complete URL is long and contains a query string, and it is not necessary if the bubble cannot fit). */
export function urlHost(args: Record<string, unknown>): string | null {
  const raw = str(args.url);
  if (raw === null) return null;
  try {
    const host = new URL(raw).host;
    return host === '' ? null : host;
  } catch {
    // Not valid URL (lack of agreement, etc.): degenerates into "remove the agreement and take the first paragraph", never throw it away
    const rest = raw.replace(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//, '');
    const head = rest.split(/[/?#]/)[0] ?? '';
    return head === '' ? null : head;
  }
}

/** Internet search: `queries` may be an array (mainstream) or a singular character string, both are recognized. */
export function queryTarget(args: Record<string, unknown>): string | null {
  const queries = args.queries;
  if (Array.isArray(queries)) {
    for (const item of queries) {
      const value = str(item);
      if (value !== null) return value;
    }
    return null;
  }
  return firstStr(args, ['queries', 'query']);
}

/** Display file: `files` is `[{ path, description }]`, take the first path (if not, take description). */
export function filesTarget(args: Record<string, unknown>): string | null {
  const files = args.files;
  if (!Array.isArray(files)) return null;
  for (const item of files) {
    if (item === null || typeof item !== 'object') continue;
    const picked = firstStr(item as Record<string, unknown>, ['path', 'description']);
    if (picked !== null) return picked;
  }
  return null;
}

/**
 * What does the command name look like: starting with ASCII, at least two characters, containing only alphanumeric
 * characters and `_ . -` . Pure numbers (`18016`), Chinese strings (`监听`), symbols (`==`), switches (`-v`), and
 * single-letter variables (`x`) are all rejected - they will almost always be character string literals or parameters,
 * not the command itself.
 */
export const COMMAND_LIKE = /^[A-Za-z][A-Za-z\d_.-]+$/;

/** What does the subcommand look like: word form (`status` / `log` / `push`), switches and paths are not accepted. */
export const SUBCOMMAND_LIKE = /^[A-Za-z][A-Za-z\d-]*$/;

/** Compound commands: `;` `|` `&&` `||` Do not guess line breaks (vertical bars within quotation marks will also be judged as compound, err on the conservative side). */
export const COMPOUND_COMMAND = /[;|]|&&|\|\||\r?\n/;

/**
 * Characters (operators, brackets, redirections, quotes, variable prefixes...) that need to be stripped off when
 * taking command names. Example: `(Get-NetTCPConnection` → `Get-NetTCPConnection` ; `$env:FOO` → `env:FOO`
 * (subsequently determined to be unsuccessful).
 */
const EDGE_CHARS = new Set('&.([{!@$^+:=,;|"\'`)]}>#');

/** Peel off the corners of characters at the beginning and end of words. */
function trimEdges(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && EDGE_CHARS.has(token.charAt(start))) start += 1;
  while (end > start && EDGE_CHARS.has(token.charAt(end - 1))) end -= 1;
  return token.slice(start, end);
}

/**
 * Cut the command line into "words": the whole word within the quotation marks is counted as one word (`"C:\Program
 * Files\node.exe"` will not be split by spaces), the quotation marks themselves are discarded, and `;` / `|` are used
 * as delimiters.
 *
 * This is not a general-purpose shell parser, it only serves "finding command names", so it only processes quotes and
 * delimiters, and does not interpret variables, escapes and pipes.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch) || ch === ';' || ch === '|') {
      if (current !== '') tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens.map(trimEdges).filter((token) => token !== '');
}

/** The upper limit of arguments parsing (number of UTF-16 code elements): it will not be parsed if it exceeds it (write / edit will bring the entire file content). */
const MAX_ARGS_CHARS = 64 * 1024;

/** The display limit (code points) of the target in the bubble: if it exceeds it, only the file name will be left. */
const TARGET_MAX = 22;

/**
 * The upper limit of the length of the target screen (code points): if it exceeds the limit, the entire sentence will
 * be replaced by the atmosphere of the tool fallback. Being smaller than TARGET_MAX is intentional - if the path still
 * exceeds this number after compression (long file name, long grep regular, long query), forcing the sentence into it
 * will burst the bubble (real case: `grep` 's pattern is `WORK_STATE_GAP_MS|busyFlip|…` ).
 */
export const TARGET_DISPLAY_MAX = 20;

/** Parse arguments (JSON character string; individual versions may directly give the object) of tool/call → parameter object; failed or oversized → null. */
export function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_ARGS_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Truncated by code points (same conventions as currentTaskFromTodo of ./work-status: TASK_TEXT_MAX + ellipsis left for extra long). */
export function clip(text: string): string {
  const points = Array.from(text);
  return points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join('')}…` : text;
}

/** Randomly select a sentence (the same sentence appearing consecutively is very false, here press randomization). */
export function pickLine(lines: readonly CopyLine[]): CopyLine {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? '';
}

/** Fill in the placeholder (`{target}` / `{cmd}` / `{tool}`); the unknown placeholder is left as is. */
export function fill(line: CopyLine, vars: Readonly<Record<string, string>>): string {
  let out = line;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(value);
  return out;
}

/**
 * Target compression: keep the short-circuit path as it is, and leave only the file name in the long path. The reason
 * for unifying them into `/` is to make the text consistent across platforms (Windows and `\` take up more
 * width in the bubble and are more difficult to read).
 */
export function compactTarget(raw: string, pathLike: boolean): string {
  if (!pathLike) return raw;
  const text = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  if (Array.from(text).length <= TARGET_MAX) return text;
  const parts = text.split('/').filter((part) => part !== '');
  return parts.length > 0 ? (parts[parts.length - 1] as string) : text;
}
