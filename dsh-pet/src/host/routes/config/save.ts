/**
 * Configuration writing: PUT /config saves the user layer, POST /config overwrites the entire copy with the built-in
 * default.
 *
 * The writing order is fixed: whitelist reconstruction → persist to disk → asynchronous restart Helper; failure will
 * always be 200 + failed entities, leaving no half file. The configuration shape is not verified (returned to ../../
 * config), and the single pet display position is not touched (returned to ./display).
 * @module dsh-pet/src/host/routes/config/save
 */
import {
  readAllConfig,
  readUserConfig,
  saveUserConfig,
  syncUserConfigFromDefault,
  userConfigUnparsable,
} from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/**
 * Write endpoint distribution: PUT saves the user layer, POST synchronizes the built-in default, and the other methods
 * are 405.
 * @param deps - route layer dependency (path, log, restart intention).
 * @param input - Parsed request (method, request body, query string).
 */
export async function saveConfigRoute(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method === 'PUT') return saveUserLayer(deps, input);
  if (input.method === 'POST') return syncFromDefault(deps);
  return methodNotAllowed();
}

/** After the whitelist rebuilds the user layer and writes to disk, the response body is the saved resolved configuration. */
async function saveUserLayer(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  const { configPaths, ctx, requestRestart, userConfigPath, userRoot } = deps;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body ?? '');
  } catch {
    return invalidJson();
  }
  try {
    // Transparent transmission retention: Read the original user file object on the current disk, bring back the
    // non-whitelist top-level fields to saveUserConfig, and save the fine-tuned configuration manually modified by the
    // user without erasing it. The JSONC tolerant parser (readUserConfig) must be used: the user layer may be the
    // config.jsonc original text with // annotation, strict JSON.parse will throw an error and swallow → existing
    // becomes undefined → whitelist reconstruction → all advanced fields will be lost.
    const existing = readUserConfig(configPaths);
    const clean = saveUserConfig(parsed, existing);
    if (!clean) {
      return failResult(
        'bad-request',
        'invalid pet config: expected { pets:[{name?,id,size,sizePercent?,balanceEnabled,display,position:{corner,marginX,marginY}}] }（id 为非空字符串且去除首尾空白后唯一；sizePercent 可选，不小于 1 的数字；display 为 web/desktop/both/none 之一；可选顶层 notificationsEnabled / whisperImageEnabled / chatImageEnabled / chatAnimationEnabled / trayEnabled 布尔；可选宠物布尔 whisperEnabled / workStatusEnabled / fixedEnabled）',
      );
    }
    // Damage pre-check: The user layer exists but even JSONC cannot be parsed (really damaged) → do not write to the
    // disk first. Saving is a whitelist reconstruction. If existing cannot be read, it means that the remaining
    // content in the file will be discarded and silent - so go back to needConfirm and let the settings page pop up
    // (cancel = do not move the file; confirm = with ? force =1 to force reconstruction).
    if (input.url.searchParams.get('force') !== '1' && userConfigUnparsable(configPaths)) {
      return failResult('user-config-unparsable', '用户配置无法解析，需确认后重建', {
        needConfirm: true,
        userFile: userConfigPath,
      });
    }
    await mkdir(userRoot, { recursive: true });
    await writeFile(userConfigPath, JSON.stringify(clean, null, 2), 'utf8');
    void requestRestart(); // display/size and other possible changes: re-parse the desktop pet and restart Helper (asynchronous, not blocking the
    // save response) response body = saved resolved configuration (same as GET /config, the fields are filled): the
    // settings page is directly handed over to flattenConfigPets for flat rendering, and only this entry-level field of
    // the client is filled.
    return okResult(readAllConfig(configPaths));
  } catch (e) {
    ctx.logger?.warn?.(`[dsh-pet] config save failed: ${e instanceof Error ? e.message : String(e)}`);
    return failResult('generate-error', 'failed to save config');
  }
}

/**
 * Write the entire built-in default configuration (`assets/config.jsonc` original text, including comments) into the
 * user configuration.
 *
 * It not only "restores the default" (merging result = built-in default), but also leaves the user with a complete
 * configuration that can be edited directly without having to copy it from the package (see syncUserConfigFromDefault
 * of ../config).
 */
function syncFromDefault(deps: PetRouteDeps): RouteResult {
  const { configPaths, requestRestart } = deps;
  try {
    syncUserConfigFromDefault(configPaths);
  } catch (e) {
    // Default file is missing/user directory is not writable: explicit failure will never leave half of the configuration file silently
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  void requestRestart(); // Configuration changed: Re-parse desktop pets and restart Helper (asynchronous, no blocking response)
  return okResult(readAllConfig(configPaths));
}
