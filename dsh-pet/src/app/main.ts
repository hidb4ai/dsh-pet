/**
 * dsh-pet independent application main process: The local HTTP service, plugin host side and desktop Helper are
 * installed in the same Electron process. Only startup assembly and log persist to disk: route (see router.ts) is not
 * implemented, window/system tray/physical (reuse desktop Helper) is not implemented. Depends on the host side of
 * apply(), the configuration and security module of standalone, and runtime/electron-helper/main.js. Always true: the
 * port is in place before Helper (it needs the configuration address before ready), and the token is only passed
 * through the request header and environment variables.
 * @module dsh-pet/src/app/main
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenPetList, readAllConfig } from '../host/config.ts';
import { dshHomeDir } from '../host/helper-process.ts';
import { apply } from '../host/index.ts';
import { createFileLogger, setDefaultLogger } from '../host/log-file.ts';
import { createStandaloneAi } from '../standalone/ai-provider.ts';
import { packageVersion } from '../standalone/check.ts';
import { createStandaloneContext, type RegisteredRoute } from '../standalone/context.ts';
import { configPathsFor } from '../standalone/options.ts';
import { createRequestSecurity } from '../standalone/request-security.ts';

import { installDesktopAuth, type DesktopSession } from './desktop-auth.ts';
import { startRouter } from './router.ts';
import { ROUTE_SEGMENT } from '../shared/constants.ts';
import { createSetup, setupMemoryBinding } from '../standalone/setup.ts';
import { openSetup } from '../standalone/open-setup.ts';

/**
 * `electron` is provided by the Electron runtime and is not a dependency of this package; only the actually used
 * members are declared. Static `import 'electron'` will cause `tsc --noEmit` to fail to find the type and the entire
 * position will turn red.
 */
interface WebContentsLike {
  on(
    event: 'console-message',
    listener: (event: unknown, level: number, message: string, line: number, sourceId: string) => void,
  ): void;
}
interface ElectronApp {
  whenReady(): Promise<void>;
  requestSingleInstanceLock(): boolean;
  exit(code?: number): void;
  on(event: 'web-contents-created', listener: (event: unknown, contents: WebContentsLike) => void): void;
  on(event: 'second-instance', listener: () => void): void;
  on(event: 'will-quit', listener: () => void): void;
}
const { app, session } = createRequire(import.meta.url)('electron') as {
  app: ElectronApp;
  session: { defaultSession: DesktopSession };
};

/** Package root directory: the same conventions as packageRoot of helper-process.ts (the upper level of the directory where the module is located) */
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const helperMain = join(packageRoot, 'runtime', 'electron-helper', 'main.js');

const log = (message: string): void => console.log(`[dsh-pet-app] ${message}`);

/** Single instance: double-click to exit directly for the second time (Chromium profile that share userData will kick each other) */
const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.exit(0);
} else {
  await boot();
}

/**
 * Start the application.
 *
 * The outer layer must be `await` : the port must be determined before `require(helperMain)` (Helper must use the
 * configuration address in the ready callback), and Helper must be require before ready (there is
 * `app.commandLine.appendSwitch` internally, and adding it after ready will not take effect).
 */
async function boot(): Promise<void> {
  // There is no console for independent applications: plugin logs, standalone logs and console of the same process
  // Helper / renderer all persist to disk. The original console method needs to take a snapshot first - the packaged
  // console will be transferred to the file logger, and the base of logger must point to the original method,
  // otherwise logger → console → logger will recur infinitely.
  const logFile = join(dshHomeDir(), 'dsh-pet', 'logs.txt');
  const rawConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  const logger = createFileLogger({
    file: logFile,
    base: rawConsole,
    debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
  });
  const toLine = (args: unknown[]): string => args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    console[level] = (...args: unknown[]): void => {
      rawConsole[level](...args);
      logger[level](toLine(args));
    };
  }
  console.log = (...args: unknown[]): void => {
    rawConsole.log(...args);
    logger.info(toLine(args));
  };
  // Pure module (config/chat/whisper) does not have ctx.logger, rely on the default export persist to disk
  setDefaultLogger(logger);

  const routes: RegisteredRoute[] = [];
  let port = 0;

  // The same security model as CLI: the token is only passed to the browser via "# token = of the configuration page address" and is not entered in the log.
  const security = createRequestSecurity();
  const ai = createStandaloneAi(dshHomeDir(), logger);
  const setup = createSetup(
    dshHomeDir(),
    ai,
    setupMemoryBinding(() => `http://127.0.0.1:${port}`, security.token),
  );
  const context = createStandaloneContext({
    port: () => port,
    logger,
    routes,
    ai,
    authenticatedUrl: security.authenticatedUrl,
  });

  const server = await startRouter(routes, { security, ai, setup, log, status, landingPage });
  port = server.port;
  const origin = `http://127.0.0.1:${port}`;
  log(`Local server ${origin}`);

  // First tell the plugin "I am the application", and then apply: apply internally short-circuit spawn and download accordingly
  process.env.DSH_PET_IN_PROCESS = '1';
  process.env.DSH_PET_APP_MODE = '1';
  // The first item opened by the standalone mode click is the local AI settings page, not the DSH site: the form must be explicitly marked as standalone.
  process.env.DSH_PET_OPEN_TARGET = 'standalone';
  // Do not inject host PID: helper’s “exit when host is gone” is only meaningful for dual processes. Setting it in the same process will kill itself.
  delete process.env.DSH_PET_HOST_PID;
  process.env.DSH_PET_CONFIG_URL = `${origin}${ROUTE_SEGMENT}/config`;
  // Right-click "Open AI Settings" and use this: Configuration page with token (consistent with CLI behavior). Naked origin has no page to view in the application.
  process.env.DSH_PET_SITE_URL = security.authenticatedUrl(origin);
  if (!process.env.DSH_PET_SCALE) process.env.DSH_PET_SCALE = '1';

  apply(context.ctx);
  setup.resume();
  if (!ai.isReady()) void app.whenReady().then(() => openSetup(security.authenticatedUrl(origin)));
  log(`apply() complete: routes=${routes.length} failures=${context.failures.length}`);

  // helper reads it and determines how many windows to create; when it cannot be read, it will fallback to a single default window, and the first frame will be self-corrected by the renderer.
  process.env.DSH_PET_PETS = JSON.stringify(desktopPets());

  // Running Helper in the same process: window creation, system tray, IPC, and collision are all completed inside it
  // (CJS, require is required). The renderer log must be transferred out - the packaged application does not have a
  // console, and renderer errors will only appear as "window transparency".
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (_e, level, message, line, source) => {
      log(`renderer [${level}] ${message} (${source}:${line})`);
    });
  });
  // The file rendering page must be created earlier than the whenReady callback of Helper.
  void app.whenReady().then(() => {
    installDesktopAuth(
      session.defaultSession,
      origin,
      join(packageRoot, 'runtime/electron-helper/index.html'),
      security.token,
    );
  });
  process.env.DSH_PET_APP_TOKEN = security.token;
  try {
    createRequire(import.meta.url)(helperMain);
  } finally {
    delete process.env.DSH_PET_APP_TOKEN;
  }

  app.on('second-instance', () => log('Another instance is already running; ignoring this launch'));
  app.on('will-quit', () => {
    // Flush out the last batch of logs before exiting (the timer can be up to 1 s, and it is explicitly replenished here)
    void logger.flush();
    logger.dispose();
    void ai.dispose();
    void setup.dispose();
    void context.dispose().catch(() => undefined);
    void server.close().catch(() => undefined);
  });
}

/**
 * List of pets visible on the desktop ([{ id , size }]). The same conventions as isDesktopVisible of
 * `src/host/index.ts` : display only has a window containing desktop/both.
 */
function desktopPets(): Array<{ id: string; size: number }> {
  try {
    const pets = flattenPetList(readAllConfig(configPathsFor(packageRoot, dshHomeDir())));
    const desktop = pets
      .filter((pet) => pet.display === 'desktop' || pet.display === 'both')
      .map((pet) => ({ id: String(pet.id), size: Number(pet.size) }));
    log(`Desktop pets ${JSON.stringify(desktop)}`);
    return desktop;
  } catch (error) {
    log(
      `Configuration read failed; using one fallback window: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/** The data source shared by the status interface and the landing page; when the configuration cannot be read, 0 will be displayed and the page will not be 500. */
function status(port: number): Record<string, unknown> {
  const paths = configPathsFor(packageRoot, dshHomeDir());
  let pets: Array<Record<string, unknown>> = [];
  try {
    pets = flattenPetList(readAllConfig(paths));
  } catch {
    /* The landing page/status interface should not cause 500 due to broken configuration: 0 is displayed as shown below. */
  }
  return {
    name: 'dsh-pet-app',
    version: packageVersion(packageRoot),
    pid: process.pid,
    port,
    pluginRoot: packageRoot,
    configFile: paths.userFile,
    pets: pets.map((pet) => ({ id: pet.id, name: pet.name, display: pet.display })),
  };
}

/** Landing page: Configuration items can only be changed to files, and the visual configuration is at /standalone-ai/ (token required). */
function landingPage(port: number): string {
  const info = status(port);
  const pets = (info.pets as Array<Record<string, unknown>>) ?? [];
  const petLines = pets.length
    ? pets
        .map((pet) => `<li>${escapeHtml(String(pet.name ?? pet.id))}（${escapeHtml(String(pet.display))}）</li>`)
        .join('')
    : '<li>（未读到宠物，检查配置文件）</li>';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-pet</title>
<style>
  body{font:14px/1.7 "Segoe UI",system-ui,sans-serif;margin:0;padding:32px;background:#f6f8fa;color:#1f2328}
  main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:28px 32px}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#656d76;margin-bottom:20px}
  h2{font-size:14px;margin:22px 0 6px} code{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:1px 6px;font-size:12px}
  ul{margin:6px 0;padding-left:20px} a{color:#0969da}
</style></head>
<body><main>
  <h1>dsh-pet 桌宠</h1>
  <div class="sub">版本 ${escapeHtml(String(info.version))} · 端口 ${port}</div>
  <h2>宠物</h2><ul>${petLines}</ul>
  <h2>配置文件</h2>
  <p><code>${escapeHtml(String(info.configFile))}</code></p>
  <p>改完配置后从托盘退出、重新打开应用即可生效（本模式没有「重载配置」菜单）。</p>
  <h2>AI 设置</h2>
  <p>AI 模型与密钥的配置页需要令牌，请<strong>右键桌宠 →「打开 AI 设置」</strong>，会直接打开已授权的页面。</p>
  <h2>状态</h2>
  <p><a href="/health">/health</a> · <a href="/standalone-ai/">配置页（未授权时读写会返回 403）</a></p>
</main></body></html>`;
}

/** HTML escape: landing page spells character string. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}
