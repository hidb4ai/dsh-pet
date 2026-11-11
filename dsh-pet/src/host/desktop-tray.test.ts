/**
 * Desktop system tray behavior contract (runtime/electron-helper/main/tray.js).
 *
 * Three actions must be established: check from configuration, click to write back the corresponding file, and exit
 * the item to decide whether to return it to the host according to the running state. All dependencies are injected by
 * caller (Tray/Menu/nativeImage including Electron), so there is no need for real Electron here.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

/** The system tray module is for Helper and CJS. There is no type declaration: here it is narrowed according to the shape used. */
interface TrayModule {
  createTray(deps: Record<string, unknown>): {
    start(): Promise<void>;
    refresh(): Promise<void>;
    exists(): boolean;
    destroy(): void;
  };
}

/** One menu item: only fields used by assertion. */
interface MenuItem {
  label: string;
  type?: string;
  checked?: boolean;
  click?: () => void;
}

const { createTray } = createRequire(import.meta.url)('../../runtime/electron-helper/main/tray.js') as TrayModule;

/** Create a set of fake dependencies: log host requests, menu templates and exit calls. */
function harness(options: {
  appMode?: boolean;
  isBridge?: boolean;
  canQuit?: boolean;
  pets?: Array<Record<string, unknown>>;
}) {
  const requests: string[] = [];
  const bodies: string[] = [];
  const quits: string[] = [];
  const menus: MenuItem[][] = [];

  class FakeTray {
    setToolTip(): void {}
    setContextMenu(menu: unknown): void {
      menus.push((menu as { template: MenuItem[] }).template);
    }
    on(): void {}
    popUpContextMenu(): void {}
    destroy(): void {}
  }

  const deps = {
    app: { quit: () => quits.push('app.quit') },
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template: MenuItem[]) => ({ template }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => false, resize: () => ({ setTemplateImage: () => {} }) }),
    },
    hostRequest: async (method: string, url: string, body?: string) => {
      requests.push(method + ' ' + url);
      if (body !== undefined) bodies.push(body);
      if (url.endsWith('/config')) {
        return { status: 200, body: JSON.stringify({ main: { pets: options.pets ?? [] } }) };
      }
      if (url.endsWith('/quit')) {
        return { status: 200, body: JSON.stringify({ canQuit: options.canQuit === true }) };
      }
      return { status: 200, body: '{}' };
    },
    callbackUrl: () => 'http://127.0.0.1:1/bridge',
    isBridge: options.isBridge ?? false,
    appMode: options.appMode ?? false,
    petRoute: '/dsh-pet-7340',
    platform: { templateImage: false, leftClickPopsMenu: false },
    helperDir: '.',
  };

  const tray = createTray(deps);
  return { tray, requests, bodies, quits, menus };
}

/** Get the last menu template built. */
function lastMenu(menus: MenuItem[][]): MenuItem[] {
  const menu = menus[menus.length - 1];
  assert.ok(menu, 'The system tray should have built a menu');
  return menu;
}

describe('createTray - Check and click', () => {
  test('The check status comes from the configuration: two including desktop / both are checked', async () => {
    const { tray, menus } = harness({
      pets: [
        { label: 'a', id: 'a', display: 'both' },
        { label: 'b', id: 'b', display: 'web' },
        { label: 'c', id: 'c', display: 'desktop' },
      ],
    });
    await tray.start();
    const items = lastMenu(menus).filter((item) => item.type === 'checkbox');
    assert.deepEqual(
      items.map((item) => item.checked),
      [true, false, true],
    );
  });

  test('Click to write back the opposite state: both → web, web → both, desktop → none, none → desktop', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['both', 'web'],
      ['web', 'both'],
      ['desktop', 'none'],
      ['none', 'desktop'],
    ];
    for (const [from, to] of cases) {
      const { tray, menus, requests, bodies } = harness({ pets: [{ label: 'a', id: 'a', display: from }] });
      await tray.start();
      const item = lastMenu(menus).find((entry) => entry.type === 'checkbox');
      assert.ok(item?.click, 'Each pet should have a clickable switch item');
      item.click();
      assert.ok(
        requests.includes('POST /dsh-pet-7340/pet-display'),
        `When display = ${from}, the new value should be written back to the host`,
      );
      assert.equal(
        (JSON.parse(bodies[0] ?? '{}') as { display?: string }).display,
        to,
        `display = ${from} should be written as ${to} (the browser bit remains unchanged)`,
      );
    }
  });
});

describe('createTray - Exit the branch of the item', () => {
  test('Application mode: self app.quit(), not requesting host', async () => {
    const { tray, menus, quits, requests } = harness({
      appMode: true,
      pets: [{ label: 'a', id: 'a', display: 'both' }],
    });
    await tray.start();
    const quit = lastMenu(menus).find((item) => item.label === '退出');
    assert.ok(quit?.click, 'Application mode must have an exit item');
    quit.click();
    assert.deepEqual(quits, ['app.quit']);
    assert.equal(
      requests.some((request) => request.startsWith('POST') && request.endsWith('/quit')),
      false,
    );
  });

  test('bridge and the host allows it: hand over the exit to the host (your own exit will be treated as a crash and restart)', async () => {
    const { tray, menus, quits, requests } = harness({
      isBridge: true,
      canQuit: true,
      pets: [{ label: 'a', id: 'a', display: 'both' }],
    });
    await tray.start();
    const quit = lastMenu(menus).find((item) => item.label === '退出');
    assert.ok(quit?.click, 'There should be an exit item when host is allowed');
    quit.click();
    assert.deepEqual(quits, [], 'bridge is not allowed to withdraw by yourself.');
    assert.ok(requests.includes('POST /dsh-pet-7340/quit'), 'The exit request must be handed over to the host');
  });

  test('bridge and host is not allowed: no exit item appears', async () => {
    const { tray, menus } = harness({
      isBridge: true,
      canQuit: false,
      pets: [{ label: 'a', id: 'a', display: 'both' }],
    });
    await tray.start();
    assert.equal(
      lastMenu(menus).some((item) => item.label === '退出'),
      false,
    );
  });
});

describe('createTray - Refresh after rebuilding', () => {
  test('refresh Reread the configuration: the check box changes and the menu is replaced', async () => {
    const pets: Array<Record<string, unknown>> = [{ label: 'a', id: 'a', display: 'both' }];
    const { tray, menus } = harness({ pets });
    await tray.start();
    assert.equal(lastMenu(menus)[0].checked, true);
    pets[0] = { label: 'a', id: 'a', display: 'web' };
    await tray.refresh();
    assert.equal(menus.length, 2, 'refresh menu should be reset once');
    assert.equal(
      lastMenu(menus)[0].checked,
      false,
      'If the configuration changes, the check box must be changed accordingly.',
    );
  });

  test('refresh does nothing when the system tray is not created (when the system tray switch is turned off)', async () => {
    const { tray, menus } = harness({ pets: [] });
    await tray.refresh();
    assert.equal(menus.length, 0);
  });
});
