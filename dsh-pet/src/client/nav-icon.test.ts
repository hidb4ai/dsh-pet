/**
 * Set the contract test of the panel navigation icon patch - verify all the prerequisites of the mechanism of
 * "recognize rows by title + mark + CSS glyph change". DSH does not have an entry point for the third party to set
 * partition icons (`navIcon(id)` uses id hard-coded whitelist + fallback state, and slot does not have an icon bit in
 * the contract), so it can only rely on DOM to make up for it; the failure performance is "icon or state" rather than
 * an error, and it is easy to degrade silently after upgrading.
 *
 * Premise: Only the line with a matching title is marked, and the other lines remain unchanged; no marking is made
 * when the title is empty (locale is not ready) to avoid accidental damage to other lines with empty titles; the mark
 * is marked on `data-*` , DSH will not be removed regardless of re-rendering / switching languages (without changing
 * the DOM node); the style is only injected once (cover the state + draw mask ); two-stage observation: body only
 * targets the direct child node, and changes to the panel subtree after hitting it; the mark can be added when the
 * panel is closed and reopened, or when the plugin is assembled when the panel is open; after dispose, the observer
 * is disconnected and no longer marked; the glyph is deferred until the panel is recognized (sprite is only on the
 * page at that time), sprite's `<use>` must first be expanded into self-contained SVG; The glyph cannot be obtained
 * (cannot be rendered/the referenced symbol is missing) → no style is injected, only an warning is issued, and the state
 * remains in place instead of turning into a zero icon.
 *
 * False DOM only implements the members used by this module (does not reference jsdom): the selector only supports
 * four forms: `tag` / `[attr]` / `[attr="v"]` / `[attr*="v"]` .
 *
 * Running method: node --experimental-strip-types --test src/client/nav-icon.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { expandUseRefs, installSectionNavIcon, svgMaskUri, symbolIn } from './nav-icon.ts';

/** Mark attribute name (consistent with MARK in the module; write a separate copy here to avoid the test becoming invalid after the implementation changes its name). */
const MARK = 'data-dsh-pet-nav';

/** camelCase → `data-` attribute name (replicate the mapping rule of `dataset`). */
function dataName(key: string): string {
  return 'data-' + key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase());
}

/** Minimalist element stand-in. */
class El {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly children: El[] = [];
  readonly dataset: Record<string, string>;
  /** Its own text (textContent in real DOM is a read-write attribute, and the module uses it to write `<style>` content). */
  ownText = '';

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tag = tag;
    for (const [key, value] of Object.entries(attrs)) this.attrs.set(key, value);
    // dataset write-back attribute: The module uses `tag.dataset.pluginCss = ...` to mark deduplicate, and then uses
    // `style[data-plugin-css="..."]` to check duplication. The two must be connected.
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (_target, key, value: string) => {
        this.attrs.set(dataName(String(key)), value);
        return true;
      },
    });
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  append(...nodes: El[]): void {
    this.children.push(...nodes);
  }

  appendChild(node: El): void {
    this.children.push(node);
  }

  removeChild(node: El): void {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  querySelectorAll(selector: string): El[] {
    return this.descendants().filter((el) => matches(el, selector));
  }

  querySelector(selector: string): El | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  private descendants(): El[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

/** Supports four forms: `tag` / `[attr]` / `[attr="v"]` / `[attr*="v"]`. */
function matches(el: El, selector: string): boolean {
  const parsed = /^([a-z]*)(?:\[([a-zA-Z-]+)(?:(\*?=)"([^"]*)")?\])?$/.exec(selector);
  if (parsed === null) throw new Error('假 DOM 不支持的 selector：' + selector);
  const [, tag, attr, op, value] = parsed;
  if (tag !== '' && el.tag !== tag) return false;
  if (attr === undefined) return true;
  const actual = el.attrs.get(attr);
  if (actual === undefined) return false;
  if (op === undefined) return true;
  return op === '*=' ? actual.includes(value ?? '') : actual === value;
}

/** Minimalist document substitute: querySelector covers both body and head (check both modules). */
class FakeDocument {
  readonly head = new El('head');
  readonly body = new El('body');

  createElement(tag: string): El {
    return new El(tag);
  }

  querySelector(selector: string): El | null {
    return this.body.querySelector(selector) ?? this.head.querySelector(selector);
  }
}

/** Minimalist MutationObserver stand-in: manual `fire()` simulates a DOM change. */
class FakeObserver {
  static created: FakeObserver[] = [];
  readonly callback: () => void;
  readonly observed: Array<{ target: unknown; options: unknown }> = [];
  disconnected = false;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeObserver.created.push(this);
  }

  observe(target: unknown, options?: unknown): void {
    this.observed.push({ target, options });
  }

  disconnect(): void {
    this.disconnected = true;
  }

  fire(): void {
    if (!this.disconnected) this.callback();
  }
}

/** Create a settings panel: `[data-shortcut-modal="settings"]` > `[class*="navList"]` > N navCell. */
function panelWith(labels: string[]): { panel: El; cells: El[] } {
  const panel = new El('div', { 'data-shortcut-modal': 'settings' });
  const list = new El('div', { class: 'VOzbGW_navList' });
  const cells = labels.map((label) => {
    const cell = new El('button', { class: 'VOzbGW_navCell' });
    const span = new El('span', { class: 'VOzbGW_navLabel' });
    span.textContent = label;
    cell.append(new El('svg', { class: 'VOzbGW_navIcon' }), span);
    list.append(cell);
    return cell;
  });
  panel.append(list);
  return { panel, cells };
}

/** Trigger all still alive observers (simulating "DOM changed"). */
function poke(): void {
  for (const observer of FakeObserver.created) observer.fire();
}

/** Install a fake DOM global and return document with the reduction function. */
function withFakeDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.MutationObserver;
  FakeObserver.created = [];
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { MutationObserver?: unknown }).MutationObserver = FakeObserver;
  return {
    doc,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.MutationObserver = previousObserver;
      FakeObserver.created = [];
    },
  };
}

/**
 * Temporarily take over `console.warn` and return the collected messages and restore function. Warnings on the downgrade
 * path must be assertions (otherwise the "silent failure" section will not be guarded) and should not pollute the test
 * output.
 */
function captureWarn(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(' '));
  };
  return {
    messages,
    restore: () => {
      console.warn = original;
    },
  };
}

/** A working fake glyph renderer (records the number of calls). */
function fakeRenderer(svg = '<svg viewBox="0 0 16 16" stroke="currentColor"><path d="M1 1h2"/></svg>'): {
  calls: number;
  renderSvg: () => string;
} {
  const renderer = {
    calls: 0,
    renderSvg: (): string => {
      renderer.calls += 1;
      return svg;
    },
  };
  return renderer;
}

describe('svgMaskUri - Inline SVG to CSS mask for data URI', () => {
  test('Add xmlns (DOM svg rendered by React does not have a namespace, data URI will not be rendered if it is missing)', () => {
    const uri = svgMaskUri('<svg viewBox="0 0 16 16"><path d="M1 1"/></svg>');
    assert.ok(uri.startsWith('url("data:image/svg+xml,'));
    assert.ok(decodeURIComponent(uri).includes('xmlns="http://www.w3.org/2000/svg"'));
  });

  test('Do not insert a duplicate copy when xmlns already exists', () => {
    const uri = svgMaskUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"/>');
    const decoded = decodeURIComponent(uri);
    assert.equal(decoded.split('xmlns=').length - 1, 1);
  });

  test('currentColor is set to opaque black (mask only looks at alpha, currentColor in data URI will degrade)', () => {
    const decoded = decodeURIComponent(svgMaskUri('<svg stroke="currentColor"/>'));
    assert.ok(decoded.includes('stroke="#000"'));
    assert.equal(decoded.includes('currentColor'), false);
  });

  test('Quotation marks and angle brackets are encoded and will not prematurely close url ("...") of CSS', () => {
    const uri = svgMaskUri('<svg a="b"/>');
    // Only the pair of quotation marks used for the package should be present; the quotation marks in SVG must be encoded
    assert.equal(uri.split('"').length - 1, 2);
    assert.ok(uri.includes('%22'));
    assert.ok(uri.includes('%3C'));
  });

  test('Empty/purely blank source code returns an empty string (the caller determines that it is unavailable based on this)', () => {
    assert.equal(svgMaskUri(''), '');
    assert.equal(svgMaskUri('   \n '), '');
  });
});

describe('expandUseRefs - Expand sprite reference into self-contained SVG', () => {
  test('sprite reference: < use > replaced by the attributes and content of symbol', () => {
    const svg = '<svg width="16" height="16" data-icon="i"><use href="#i"></use></svg>';
    const expanded = expandUseRefs(svg, () => ({ attrs: { viewBox: '0 0 16 16' }, content: '<path d="M1 1h2"/>' }));
    assert.equal(expanded, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1h2"/></svg>');
  });

  test('xlink:href is also recognized (the old way of writing React)', () => {
    const expanded = expandUseRefs('<svg><use xlink:href="#i"/></svg>', () => ({ attrs: {}, content: '<path/>' }));
    assert.ok(expanded?.includes('<path/>'));
  });

  test('The reference cannot be obtained → undefined (the caller retains the fallback state and does not inject a blank mask)', () => {
    assert.equal(
      expandUseRefs('<svg><use href="#missing"></use></svg>', () => undefined),
      undefined,
    );
  });

  test('Inline SVG without reference is passed through as is (0.2.1 and earlier icon forms)', () => {
    const svg = '<svg viewBox="0 0 16 16"><path d="M1 1"/></svg>';
    assert.equal(
      expandUseRefs(svg, () => ({ attrs: {}, content: '不该用到' })),
      svg,
    );
  });
});

describe('symbolIn - Get attributes and content from host < symbol >', () => {
  test('Skip id when moving attributes, and bring the content as it is; return undefined if it cannot be found.', () => {
    const rows = [
      { name: 'id', value: 'i' },
      { name: 'viewBox', value: '0 0 16 16' },
      { name: 'stroke', value: 'currentColor' },
    ];
    const symbol = {
      attributes: { length: rows.length, item: (index: number) => rows[index] ?? null },
      innerHTML: '<path d="M1 1h2"/>',
    } as unknown as Element;

    assert.deepEqual(symbolIn(() => symbol)('i'), {
      attrs: { viewBox: '0 0 16 16', stroke: 'currentColor' },
      content: '<path d="M1 1h2"/>',
    });
    assert.equal(symbolIn(() => null)('i'), undefined);
  });
});

describe('installSectionNavIcon - Settings panel navigation icon change', () => {
  test('Only mark the line whose title matches, leaving the other lines unchanged.', () => {
    const { doc, restore } = withFakeDom();
    try {
      const { panel, cells } = panelWith(['通用', '桌宠配置', '子智能体']);
      doc.body.append(panel);

      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });

      assert.equal(cells[0].getAttribute(MARK), null);
      assert.equal(cells[1].getAttribute(MARK), '');
      assert.equal(cells[2].getAttribute(MARK), null);
      dispose();
    } finally {
      restore();
    }
  });

  test('Do not mark when the title is empty (locale not ready) to avoid accidentally damaging other lines with empty titles.', () => {
    const { doc, restore } = withFakeDom();
    try {
      const { panel, cells } = panelWith(['', '']);
      doc.body.append(panel);

      const dispose = installSectionNavIcon({ label: () => '', renderSvg: fakeRenderer().renderSvg });

      assert.deepEqual(
        cells.map((cell) => cell.getAttribute(MARK)),
        [null, null],
      );
      dispose();
    } finally {
      restore();
    }
  });

  test('The mark is placed on React but not data -* which is never diff: the title will not be removed even if the title is changed (re-rendering will not remove the mark)', () => {
    const { doc, restore } = withFakeDom();
    try {
      const { panel, cells } = panelWith(['桌宠配置']);
      doc.body.append(panel);
      let label = '桌宠配置';
      const dispose = installSectionNavIcon({ label: () => label, renderSvg: fakeRenderer().renderSvg });
      assert.equal(cells[0].getAttribute(MARK), '');

      // Simulate switching languages: DSH re-renders this line and the title text changes; React will not touch the data -* we added
      label = 'Pet Config';
      const span = cells[0].querySelector('[class*="navLabel"]');
      assert.ok(span !== null);
      span.textContent = 'Pet Config';
      poke();

      assert.equal(cells[0].getAttribute(MARK), '');
      dispose();
    } finally {
      restore();
    }
  });

  test('The style is only injected once, and it is indeed "cover the state + draw mask"', () => {
    const { doc, restore } = withFakeDom();
    try {
      const { panel } = panelWith(['桌宠配置']);
      doc.body.append(panel);

      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });
      poke();

      const styles = doc.head.querySelectorAll('style[data-plugin-css="dsh-pet/nav-icon.css"]');
      assert.equal(styles.length, 1);
      const css = styles[0].textContent;
      assert.ok(css.includes('[' + MARK + '] [class*="navIcon"]{display:none}'));
      assert.ok(css.includes('mask:url("data:image/svg+xml,'));
      assert.ok(css.includes('center/16px 16px no-repeat'));
      dispose();
    } finally {
      restore();
    }
  });

  test('The glyph is only rendered once (the icon is static and should not be re-rendered every time the panel is opened)', () => {
    const { doc, restore } = withFakeDom();
    try {
      const { panel } = panelWith(['桌宠配置']);
      doc.body.append(panel);
      const renderer = fakeRenderer();

      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: renderer.renderSvg });
      poke();
      poke();
      assert.equal(renderer.calls, 1);
      dispose();
    } finally {
      restore();
    }
  });

  test('Two-stage observation: body only targets the direct child node, and changes to the panel subtree after hitting it (do not run subtree on the full document)', () => {
    const { doc, restore } = withFakeDom();
    try {
      // The panel is not open yet: there is only one observer staring at body, and subtree is not open (otherwise the jitter of DOM in the chat area will slow down the entire page)
      const disposeBefore = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });
      assert.equal(FakeObserver.created.length, 1);
      assert.equal(FakeObserver.created[0].observed[0].target, doc.body);
      assert.deepEqual(FakeObserver.created[0].observed[0].options, { childList: true });
      disposeBefore();

      // The panel is open: there is one more observer watching the panel subtree, the one body still only watches the direct child nodes
      FakeObserver.created = [];
      const { panel } = panelWith(['桌宠配置']);
      doc.body.append(panel);
      const disposeAfter = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });

      assert.equal(FakeObserver.created.length, 2);
      const onPanel = FakeObserver.created.find((observer) => observer.observed[0]?.target === panel);
      const onBody = FakeObserver.created.find((observer) => observer.observed[0]?.target === doc.body);
      assert.ok(onPanel !== undefined, 'There should be an observer watching the panel');
      assert.ok(onBody !== undefined, 'There should be an observer watching body');
      assert.deepEqual(onPanel.observed[0].options, { childList: true, subtree: true });
      assert.deepEqual(onBody.observed[0].options, { childList: true });
      disposeAfter();
    } finally {
      restore();
    }
  });

  test('Panel rear opening: body changes trigger synchronization and add mark after synchronization', () => {
    const { doc, restore } = withFakeDom();
    try {
      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });
      const { panel, cells } = panelWith(['通用', '桌宠配置']);
      doc.body.append(panel);
      assert.equal(cells[1].getAttribute(MARK), null);

      poke();
      assert.equal(cells[1].getAttribute(MARK), '');
      dispose();
    } finally {
      restore();
    }
  });

  test('The panel is closed and reopened: the observer switches to a new panel, and the new lines are still marked.', () => {
    const { doc, restore } = withFakeDom();
    try {
      const first = panelWith(['桌宠配置']);
      doc.body.append(first.panel);
      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });
      assert.equal(first.cells[0].getAttribute(MARK), '');

      doc.body.removeChild(first.panel);
      const second = panelWith(['桌宠配置']);
      doc.body.append(second.panel);
      poke();

      assert.equal(second.cells[0].getAttribute(MARK), '');
      dispose();
    } finally {
      restore();
    }
  });

  test('After dispose the observer is disconnected and new panels are no longer marked.', () => {
    const { doc, restore } = withFakeDom();
    try {
      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });
      dispose();

      const { panel, cells } = panelWith(['桌宠配置']);
      doc.body.append(panel);
      poke();
      assert.equal(cells[0].getAttribute(MARK), null);
    } finally {
      restore();
    }
  });

  test('Icon rendering error → No style injection, only one warning (the state remains the same, that row will not become a zero icon)', () => {
    const { doc, restore } = withFakeDom();
    const warn = captureWarn();
    try {
      const { panel } = panelWith(['桌宠配置']);
      doc.body.append(panel);

      const dispose = installSectionNavIcon({
        label: () => '桌宠配置',
        renderSvg: () => {
          throw new Error('react-dom 缺失');
        },
      });

      assert.equal(doc.head.querySelectorAll('style').length, 0);
      assert.equal(warn.messages.length, 1);
      assert.ok(warn.messages[0].includes('react-dom 缺失'));
      dispose();
    } finally {
      warn.restore();
      restore();
    }
  });

  test('Rendered to empty SVG → No style or warning will be injected (mask pointing to empty image will not be injected)', () => {
    const { doc, restore } = withFakeDom();
    const warn = captureWarn();
    try {
      // Glyph analysis is delayed until the panel is recognized, so install the panel first and then open the panel.
      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: () => '  ' });
      const { panel } = panelWith(['桌宠配置']);
      doc.body.append(panel);
      poke();

      assert.equal(doc.head.querySelectorAll('style').length, 0);
      assert.equal(warn.messages.length, 1);
      assert.ok(warn.messages[0].includes('空 SVG'));
      dispose();
    } finally {
      warn.restore();
      restore();
    }
  });

  test('Missing MutationObserver → not installed, warning', () => {
    const { restore } = withFakeDom();
    const warn = captureWarn();
    try {
      (globalThis as { MutationObserver?: unknown }).MutationObserver = undefined;
      const dispose = installSectionNavIcon({ label: () => '桌宠配置', renderSvg: fakeRenderer().renderSvg });
      assert.equal(warn.messages.length, 1);
      assert.ok(warn.messages[0].includes('MutationObserver'));
      dispose();
    } finally {
      warn.restore();
      restore();
    }
  });

  test('The title thunk is thrown incorrectly → skip this round and only alert once (the state remains the same and the screen is not refreshed)', () => {
    const { doc, restore } = withFakeDom();
    const warn = captureWarn();
    try {
      const { panel, cells } = panelWith(['桌宠配置']);
      doc.body.append(panel);

      const dispose = installSectionNavIcon({
        label: () => {
          throw new Error('locale 未就绪');
        },
        renderSvg: fakeRenderer().renderSvg,
      });
      poke();
      poke();

      assert.equal(cells[0].getAttribute(MARK), null);
      assert.equal(warn.messages.length, 1);
      assert.ok(warn.messages[0].includes('locale 未就绪'));
      dispose();
    } finally {
      warn.restore();
      restore();
    }
  });
});
