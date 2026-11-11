/**
 * Set contract test for page style injection (src/client/settings/css.ts).
 *
 * Two contracts:
 * 1. Idempotent: The same page is repeatedly rendered on the settings page, leaving only one `<style>` , and the
 * deduplicate mark is marked on `data-plugin-css` ;
 * 2. No DOM security: Return silently when there is no document (SSR or pure single test environment) to prevent the
 * entire setting page from crashing.
 *
 * False DOM only implements the members used by this module (does not reference jsdom): the selector only supports
 * three forms: `tag` / `[attr]` / `[attr="v"]` .
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { injectSettingsCss } from './css.ts';

/** Minimalist element stand-in: `dataset` writes back the `data-*` attribute, which is consistent with the real DOM. */
class El {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly children: El[] = [];
  readonly dataset: Record<string, string>;
  ownText = '';

  constructor(tag: string) {
    this.tag = tag;
    const name = (key: string): string => 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    // Both reading and writing go through the attribute table: dataset in the real DOM is the view of data -*. After the module writes the mark, the same copy is checked and re-read.
    this.dataset = new Proxy({} as Record<string, string>, {
      set: (_target, key, value: string) => {
        this.attrs.set(name(String(key)), value);
        return true;
      },
      get: (_target, key) => this.attrs.get(name(String(key))),
    });
  }

  get textContent(): string {
    return this.ownText;
  }

  set textContent(value: string) {
    this.ownText = value;
  }

  appendChild(node: El): void {
    this.children.push(node);
  }

  querySelector(selector: string): El | null {
    return this.children.flatMap((child) => [child, ...child.children]).find((el) => matches(el, selector)) ?? null;
  }
}

/** Supports three forms: `tag` / `[attr]` / `[attr="v"]`. */
function matches(el: El, selector: string): boolean {
  const parsed = /^([a-z]*)(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?$/.exec(selector);
  if (parsed === null) throw new Error('假 DOM 不支持的 selector：' + selector);
  const [, tag, attr, value] = parsed;
  if (tag !== '' && el.tag !== tag) return false;
  if (attr === undefined) return true;
  const actual = el.attrs.get(attr);
  if (actual === undefined) return false;
  return value === undefined ? true : actual === value;
}

/** Minimalist document stand-in: only head, createElement and top-level querySelector are provided. */
class FakeDocument {
  readonly head = new El('head');

  createElement(tag: string): El {
    return new El(tag);
  }

  querySelector(selector: string): El | null {
    return this.head.querySelector(selector);
  }
}

/** Install a set of fake DOM and return document with the reduction function. */
function withFakeDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const previous = globalThis.document;
  (globalThis as { document?: unknown }).document = doc;
  return {
    doc,
    restore: () => {
      (globalThis as { document?: unknown }).document = previous;
    },
  };
}

describe('injectSettingsCss - Setting page style injection', () => {
  test('First injection: style with dsh-pet mark appears in head, and the class names of both families are in', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      assert.equal(doc.head.children.length, 1, 'Only one style should be injected');
      const [tag] = doc.head.children;
      assert.equal(tag.tag, 'style');
      assert.equal(tag.dataset.plugin, 'dsh-pet');
      assert.equal(tag.dataset.pluginCss, 'dsh-pet/settings.css');
      assert.ok(tag.textContent.includes('.dsh-pet-mp__trigger'), 'The style of the model selector must be in');
      assert.ok(tag.textContent.includes('.dsh-pet-cfg__inp'), 'The style of configuring the card form must be in');
    } finally {
      restore();
    }
  });

  test('Repeated injection: style will no longer be inserted in the second and third calls.', () => {
    const { doc, restore } = withFakeDom();
    try {
      injectSettingsCss();
      injectSettingsCss();
      injectSettingsCss();
      assert.equal(
        doc.head.children.length,
        1,
        'If the deduplicate tag fails, it will be inserted repeatedly and the style rules will be doubled.',
      );
    } finally {
      restore();
    }
  });

  test('No document: Return silently without throwing', () => {
    assert.doesNotThrow(() => injectSettingsCss(), '无 DOM 环境下注入必须是空操作');
  });
});
