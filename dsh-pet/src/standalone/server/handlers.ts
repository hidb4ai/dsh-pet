/**
 * Built-in route processor: settings page, connectivity self-test and model list.
 *
 * It is not responsible for distribution and monitoring; the request body has been parsed by the upper layer and its
 * length is limited. Must always be true: the settings page only returns local data, never credentials.
 * @module dsh-pet/src/standalone/server/handlers
 */
import { publicSettings, validateSettings, type StandaloneSettingsService } from '../settings.ts';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { rejectRequest } from '../request-security.ts';
import type { ModelDiscoveryInput } from '../ai-provider/types.ts';
import { sendJson } from './respond.ts';
import type { SetupService } from '../setup.ts';
import { setupErrorMessage } from '../setup-models.ts';

/** Installation is explicit, authenticated and asynchronous; polling never returns credentials. */
export function setupHandler(
  setup: SetupService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!setup) {
      rejectRequest(res, 503, 'Quick setup is unavailable in this environment');
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, setup.status());
      return;
    }
    if (req.method !== 'POST') {
      rejectRequest(res, 405, 'GET or POST required');
      return;
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      rejectRequest(res, 415, 'JSON required');
      return;
    }
    try {
      const input = await readJsonBody(req);
      if (input && typeof input === 'object' && 'action' in input && input.action === 'models' && setup.discover) {
        sendJson(res, 200, await setup.discover(input));
        return;
      }
      setup.submit(input);
      sendJson(res, 202, setup.status());
    } catch (error) {
      const busy = error instanceof Error && error.message === 'setup_busy';
      rejectRequest(res, busy ? 409 : 400, busy ? 'Preparation in progress; please wait.' : setupErrorMessage(error));
    }
  };
}

/** The request body is read and parsed into JSON; the empty body is treated as an empty object. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.once('end', resolve);
    req.once('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** Only drafts in the form of objects are accepted; arrays, scalars, and null are treated as unfilled. */
function asDraft(body: unknown): ModelDiscoveryInput {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as ModelDiscoveryInput) : {};
}

/**
 * Create and set the read and write processor (GET reads, POST stores).
 * @param ai - Setup service.
 * @returns Asynchronous function that handles requests.
 */
export function settingsHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let windowStart = Date.now();
  let count = 0;
  return async (req, res) => {
    if (!ai) {
      rejectRequest(res, 503, 'Local AI settings are not ready');
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, publicSettings(ai.getSettings()));
      return;
    }
    if (req.method !== 'POST') {
      rejectRequest(res, 405, 'GET or POST required');
      return;
    }
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      count = 0;
    }
    count += 1;
    // Saving is a heavy operation, and the one-minute window rate limiting is used to prevent the settings page from being retried repeatedly and exploding the disk.
    if (count > 20) {
      rejectRequest(res, 429, 'Too many save requests; try again later');
      return;
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      rejectRequest(res, 415, 'Use JSON to save settings');
      return;
    }
    try {
      const input = validateSettings(await readJsonBody(req));
      sendJson(res, 200, publicSettings(await ai.saveSettings(input)));
    } catch {
      rejectRequest(res, 400, 'Settings were not saved; check the endpoint, model, key and numeric ranges');
    }
  };
}

/**
 * Create connectivity test handler (POST).
 * @param ai - Setup service.
 * @returns Asynchronous function that handles requests.
 */
export function testHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      rejectRequest(res, 405, 'POST required');
      return;
    }
    try {
      const input = asDraft(await readJsonBody(req));
      if (ai?.testConnection) sendJson(res, 200, await ai.testConnection(input));
      else sendJson(res, 200, { ok: false, message: '当前环境未配置测试能力' });
    } catch {
      sendJson(res, 400, { ok: false, message: '请求格式无效' });
    }
  };
}

/**
 * Create model manifest processor (POST).
 * @param ai - Setup service.
 * @returns Asynchronous function that handles requests.
 */
export function modelsHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      rejectRequest(res, 405, 'POST required');
      return;
    }
    if (!ai?.discoverModels) {
      sendJson(res, 200, { ok: false, code: 'input', message: '当前环境未配置模型清单能力' });
      return;
    }
    try {
      sendJson(res, 200, await ai.discoverModels(asDraft(await readJsonBody(req))));
    } catch {
      sendJson(res, 400, { ok: false, code: 'input', message: '请求格式无效' });
    }
  };
}

/**
 * Create balance query processor (POST).
 *
 * The service provider and key are taken from the saved settings, and the request body does not participate: to
 * prevent the caller from passing the key again through the query interface.
 * @param ai - Setup service.
 * @returns Asynchronous function that handles requests.
 */
export function balanceHandler(
  ai: StandaloneSettingsService | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      rejectRequest(res, 405, 'POST required');
      return;
    }
    if (!ai?.queryBalance) {
      sendJson(res, 200, { ok: false, provider: '', reason: 'unsupported' });
      return;
    }
    try {
      sendJson(res, 200, await ai.queryBalance());
    } catch {
      sendJson(res, 200, { ok: false, provider: '', reason: 'fetch-error', message: '余额查询失败' });
    }
  };
}
