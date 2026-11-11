/**
 * Setup page description bubble (src/client/settings/tip-layer.ts) contract test.
 *
 * Verify four things: the bubble comes out when `data-tip` is hit; the coordinates are clipped back to the viewport
 * when welding (this is the reason why the pseudo-element scheme loses words); it is folded when leaving, scrolling,
 * and pressing; after being removed, no monitor and node are left, and it can work again after reinstalling it.
 *
 * False DOM only implements the members used by this module (do not quote jsdom): class is represented by Set. `style`
 * is an ordinary object. The elements are not typeset, and the width and height are directly given.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { attachTipLayer } from './tip-layer.ts';

/** Minimalist element stand-in: `parent` is connected to `remove()`, used to verify "attached to body/removed from body". */
class FakeEl {
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  textContent = '';
  /** False DOM has no typesetting: given a fixed width and height, the real size is available for positioning calculation (aligned with the magnitude of the 150-word description). */
  offsetWidth = 300;
  offsetHeight = 120;

  get parentNode(): FakeEl | null {
    return this.parent;
  }

  get classList(): {
    add: (name: string) => void;
    remove: (name: string) => void;
    contains: (name: string) => boolean;
  } {
    const classes = this.classes;
    return {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  appendChild(el: FakeEl): void {
    el.parent = this;
    this.children.push(el);
  }

  removeChild(el: FakeEl): void {
    const index = this.children.indexOf(el);
    if (index >= 0) this.children.splice(index, 1);
    el.parent = null;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }
}

/** Minimalist event target: record monitoring, `fire()` simulates one dispatch. */
class FakeTarget {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** The number of currently hanging monitors of this type (used to verify that they are indeed removed during unmount and that repeated installations do not overlap). */
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fire(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

/** Minimalist window stand-in + viewport size. */
class FakeWindow extends FakeTarget {
  innerWidth = 1280;
  innerHeight = 800;
}

/** Minimalist document stand-in. */
class FakeDocument extends FakeTarget {
  readonly body = new FakeEl();

  createElement(): FakeEl {
    return new FakeEl();
  }
}

/** False trigger element: `closest` returns itself, so the "same element" judgment is established based on the identity of the object. */
interface FakeTrigger {
  getAttribute: (name: string) => string | null;
  closest: (selector: string) => FakeTrigger | null;
}

function fakeTrigger(text: string | null): FakeTrigger {
  const node: FakeTrigger = {
    getAttribute: (name) => (name === 'data-tip' ? text : null),
    closest: () => node,
  };
  return node;
}

/** Install a fake global, return document and restore function. */
function withFakeDom(): { doc: FakeDocument; restore: () => void } {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = win;
  return {
    doc,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

/** A hover event: cursor position + event target. */
function hover(target: unknown, x = 100, y = 100): { target: unknown; clientX: number; clientY: number } {
  return { target, clientX: x, clientY: y };
}

/** The bubble currently hanging on body. */
function bubbles(doc: FakeDocument): FakeEl[] {
  return doc.body.children.filter((el) => el.attrs.get('class') === 'pet-cfg-tip');
}

describe('attachTipLayer —— Description bubble', () => {
  test('Hover to the element with data-tip: bubble hangs on body, text and display are in place', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      doc.fire('pointerover', hover(fakeTrigger('对话配图张数上限的说明')));
      const bubble = bubbles(doc);
      assert.equal(
        bubble.length,
        1,
        'The bubble should be hung on body (the content area of the settings page is a scroll container, and it will be cut off if it is hung inside)',
      );
      assert.equal(bubble[0].attrs.get('role'), 'tooltip');
      assert.equal(bubble[0].textContent, '对话配图张数上限的说明');
      assert.equal(bubble[0].classList.contains('is-on'), true);
    } finally {
      detach();
      restore();
    }
  });

  test('Hover to an element without data-tip: no bubble appears', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      doc.fire('pointerover', hover({ closest: () => null }));
      assert.equal(bubbles(doc).length, 0);
    } finally {
      detach();
      restore();
    }
  });

  test('Right edge: When the cursor is placed on the right side, the bubble flips to the left of the cursor, and the entire block is still within the viewport.', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      // 1270 + 10 + 300 Go past 1280 and turn to the left: 1270 - 10 - 300 = 960
      doc.fire('pointerover', hover(fakeTrigger('说明'), 1270, 400));
      const bubble = bubbles(doc)[0];
      assert.equal(bubble.style.left, '960px');
      assert.ok(
        Number.parseInt(bubble.style.left, 10) + 300 <= 1280,
        'The right edge cannot extend beyond the viewport',
      );
    } finally {
      detach();
      restore();
    }
  });

  test('Bottom edge: When the cursor is at the bottom, the bubble flips over the cursor and the entire block is still within the viewport.', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      // 790 + 10 + 120 Go past 800 and flip to the top: 790 - 10 - 120 = 660
      doc.fire('pointerover', hover(fakeTrigger('说明'), 400, 790));
      const bubble = bubbles(doc)[0];
      assert.equal(bubble.style.top, '660px');
      assert.ok(Number.parseInt(bubble.style.top, 10) + 120 <= 800, 'The lower edge cannot extend beyond the viewport');
    } finally {
      detach();
      restore();
    }
  });

  test('Cursor leaves: only the elements are shown and hidden, and the element remains reuse (hovering frequently, repeated creation and deletion will cause it to flash)', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger));
      doc.fire('pointerout', { target: trigger, relatedTarget: null });
      assert.equal(bubbles(doc).length, 1);
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);
    } finally {
      detach();
      restore();
    }
  });

  test("The cursor moves into the trigger element's own child node: it does not count as leaving, and the bubble does not flash.", () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger));
      // closest of the child node still points to the same trigger element
      doc.fire('pointerout', { target: { closest: () => trigger }, relatedTarget: trigger });
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), true);
    } finally {
      detach();
      restore();
    }
  });

  test('After scrolling or being pressed: the bubble is immediately folded (fixed positioning will not follow the content, and will be misaligned if left on)', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      doc.fire('pointerover', hover(fakeTrigger('说明')));
      doc.fire('scroll', {});
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);

      doc.fire('pointerover', hover(fakeTrigger('说明')));
      doc.fire('pointerdown', {});
      assert.equal(bubbles(doc)[0].classList.contains('is-on'), false);
    } finally {
      detach();
      restore();
    }
  });

  test('Repeated distribution within the same trigger element: only placed once, no repeated transpositions', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      const trigger = fakeTrigger('说明');
      doc.fire('pointerover', hover(trigger, 100, 100));
      doc.fire('pointerover', hover(trigger, 600, 600));
      assert.equal(bubbles(doc)[0].style.left, '110px');
    } finally {
      detach();
      restore();
    }
  });
});

describe('attachTipLayer - Installation and removal', () => {
  test('There is a monitor when it is installed, but no monitor or bubble is left after it is removed.', () => {
    const { doc, restore } = withFakeDom();
    const detach = attachTipLayer();
    try {
      assert.equal(doc.count('pointerover'), 1);
      assert.equal(doc.count('pointerout'), 1);
      assert.equal(doc.count('pointerdown'), 1);
      assert.equal(doc.count('scroll'), 1);

      doc.fire('pointerover', hover(fakeTrigger('说明')));
      detach();
      assert.equal(bubbles(doc).length, 0, 'bubble should be removed from body');
      for (const type of ['pointerover', 'pointerout', 'pointerdown', 'scroll']) {
        assert.equal(doc.count(type), 0, type + ' 监听应该摘干净');
      }
    } finally {
      restore();
    }
  });

  test('Repeated installation: return the same dismantling function, monitoring is not superimposed', () => {
    const { doc, restore } = withFakeDom();
    const first = attachTipLayer();
    try {
      const second = attachTipLayer();
      assert.equal(second, first);
      assert.equal(doc.count('pointerover'), 1);
    } finally {
      first();
      restore();
    }
  });

  test('After disassembly and reinstallation: it can still work, it is not a one-time use', () => {
    const { doc, restore } = withFakeDom();
    const first = attachTipLayer();
    first();
    const second = attachTipLayer();
    try {
      doc.fire('pointerover', hover(fakeTrigger('说明')));
      assert.equal(bubbles(doc).length, 1);
    } finally {
      second();
      restore();
    }
  });
});
