/**
 * Add a title and icon to the "/" menu line of the third-party host command. DSH does not have an entry point to
 * configure a face for the command, so it can only wrap `commandUi.candidates` : it uses a closure to check the
 * instance method at runtime, and just wrap it in one layer. It is not responsible for the registration and execution
 * of commands, only candidate lines are changed; lines with icons are released as they are, and will automatically
 * give way after official support in the future. Downgrade principle: patch exceptions will only return the original
 * line and never damage the "/" menu; errors in the original method will not be swallowed.
 * @module dsh-pet/src/client/command-faces
 */
import type { ComponentType } from 'react';
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives';

/** The minimum shape of DSH `ctx.commandUi`, only declares the members used by the face patch. */
export interface CommandUiLike {
  /** Candidate row methods; prototype methods can be obscured by own properties. */
  candidates?: (session: unknown, req: unknown) => Promise<unknown>;
}

/** An additional interface for the host command in the "/" menu. */
export interface CommandFace {
  /** Row title; each time candidate polling is taken, the language switch takes effect when the next round of menu is opened. */
  label: () => string;
  /** Line icon; the icon grid of DSH is fixed at 14×14 px, and only `size` is passed during rendering. */
  icon: ComponentType<IconProps>;
}

/**
 * Add a title and icon to the "/" menu line of the host command.
 * @param commandUi - commandUi service instance.
 * @param faces - Mapping of command names (without leading slash) to supplementary faces.
 * @returns restores the cleanup function of the original method.
 */
export function installCommandFaces(commandUi: CommandUiLike, faces: ReadonlyMap<string, CommandFace>): () => void {
  const original = commandUi.candidates;
  if (typeof original !== 'function') {
    console.warn('[dsh-pet] Command icons unavailable: commandUi.candidates missing; commands remain usable');
    return () => {};
  }

  const patched = async (session: unknown, req: unknown): Promise<unknown> => {
    const rows: unknown = await original.call(commandUi, session, req);
    try {
      if (!Array.isArray(rows)) return rows;
      return rows.map((raw: unknown): unknown => {
        if (raw === null || typeof raw !== 'object') return raw;
        const row = raw as { name?: unknown; icon?: unknown };
        const face = faces.get(typeof row.name === 'string' ? row.name : '');
        // DSH If you have already given the icon, it will be released as it is without overwriting.
        if (face === undefined || row.icon !== undefined) return row;
        return { ...row, label: face.label(), icon: face.icon };
      });
    } catch (error) {
      console.warn(
        '[dsh-pet] Command icon patch failed; using the original menu item:' +
          (error instanceof Error ? error.message : String(error)),
      );
      return rows;
    }
  };

  commandUi.candidates = patched;
  return () => {
    // Only restore the portion you packed: If a latecomer wraps it again, don’t erase its packaging.
    if (commandUi.candidates === patched) commandUi.candidates = original;
  };
}
