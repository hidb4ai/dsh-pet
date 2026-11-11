/**
 * Detail generation: collapse the tool call into one sentence, and refine it according to the command content if
 * necessary.
 *
 * The state position and other fields of the bubble (owned by ./work-status) are not determined, and notifications are
 * not sent. It must always be true: the output length ≤ TASK_TEXT_MAX + 1 (including ellipses), compound commands will
 * not be guessed.
 * @module dsh-pet/src/host/tool-detail/detail
 */
import {
  COMMAND_LIKE,
  COMPOUND_COMMAND,
  SUBCOMMAND_LIKE,
  TARGET_DISPLAY_MAX,
  clip,
  compactTarget,
  fill,
  parseArgs,
  pickLine,
  str,
  tokenizeCommand,
} from './target.ts';
import {
  COMMAND_COPY,
  COMMAND_FALLBACK,
  COMMAND_NAME_TOO_LONG,
  SILENT_TOOLS,
  TOOL_COPY,
  TOOL_RULES,
  UNKNOWN_TOOL_LINE,
} from './copy.ts';

/**
 * When looking up the table according to the external key, only the own attributes are recognized.
 *
 * The table is an ordinary object, and the key comes from the tool name and command name given by the model:
 * `constructor` / `toString` / `__proto__` will hit the prototype chain, and what is retrieved is not the copy but the
 * function. Such names have no special semantics and are treated as "nothing in the table".
 */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * The text of `pwsh` : Check the table according to the command name (add subcommand if necessary), but
 * fallback cannot be found.
 *
 * Compound command → null, let the front-end fallback configure the copy (unable to determine what is really being
 * done); `git log` hits "command + subcommand" using subcommand copy, only hits commands (`git`, `cd` ), uses general
 * copy, none hits (`npm`, `python` , `node` ...) and goes fallback —— fallback With the command name, at least you
 * know what you are running.
 */
function pwshDetail(args: Record<string, unknown> | null): string | null {
  const command = args === null ? null : str(args.command);
  if (command === null) return null;
  if (COMPOUND_COMMAND.test(command)) return null;
  const tokens = tokenizeCommand(command);
  const nameAt = tokens.findIndex((token) => COMMAND_LIKE.test(token));
  if (nameAt < 0) return null;
  const rawCmd = tokens[nameAt] as string;
  const lookup = rawCmd.toLowerCase();
  // Subcommand: The first "subcommand-like" word after the command name (skip switches and parameter values)
  const subAt = tokens.findIndex((token, index) => index > nameAt && SUBCOMMAND_LIKE.test(token));
  const sub = subAt < 0 ? null : (tokens[subAt] as string).toLowerCase();
  const lines = (sub === null ? undefined : own(COMMAND_COPY, `${lookup} ${sub}`)) ?? own(COMMAND_COPY, lookup);
  if (lines !== undefined) return clip(pickLine(lines));
  // The command name itself is too long (such as Get-NetTCPConnection) → fallback without name
  if (Array.from(rawCmd).length > TARGET_DISPLAY_MAX) return clip(COMMAND_NAME_TOO_LONG);
  return clip(fill(pickLine(COMMAND_FALLBACK), { cmd: rawCmd }));
}

/**
 * `tool/call` event → bubble details; skipped, unable to be parsed, no information → null.
 *
 * The return value can be written directly into `sections.workStatus.data.task` (length ≤ TASK_TEXT_MAX + 1).
 */
export function toolDetailFromEvent(
  event: { data?: { name?: unknown; arguments?: unknown } } | null | undefined,
): string | null {
  const name = str(event?.data?.name);
  if (name === null) return null;
  if (SILENT_TOOLS.has(name)) return null;
  const args = parseArgs(event?.data?.arguments);
  // pwsh walks the command list (it does not have a "file target", the target is the command itself)
  if (name === 'pwsh') return pwshDetail(args);
  const entry = own(TOOL_COPY, name);
  // Unknown tool: No parameter guessing, no tool name reported
  if (entry === undefined) return clip(UNKNOWN_TOOL_LINE);
  const rule = own(TOOL_RULES, name);
  const line = pickLine(entry.lines);
  // workflow This kind of sentence does not have an object, just give it directly (no target is required)
  if (!line.includes('{target}')) return clip(line);
  const target = args === null || rule === undefined ? null : rule.pick(args);
  // Cannot get the target → null, does not cover the existing copy in the bubble (todo copy has more information than half a sentence)
  if (target === null) return null;
  const shown = compactTarget(target, rule?.path === true);
  // The target is too long → Change to a fallback without a name (forcing it will burst the bubble, see the description of TARGET_DISPLAY_MAX)
  if (Array.from(shown).length > TARGET_DISPLAY_MAX) return clip(entry.short);
  return clip(fill(line, { target: shown }));
}
