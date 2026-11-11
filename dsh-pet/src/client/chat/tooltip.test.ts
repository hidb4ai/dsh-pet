/**
 * Contract test of panel floating prompt - verify "body layer bubble, position by cursor, leave/scroll to collapse,
 * unmount recycling".
 *
 * The bubble cannot be drawn in the message list (the list is overflow:auto, and the pseudo elements will be cut off).
 * Once this is changed back to the CSS scheme, the performance is "the top message cannot see the prompt" instead of
 * an error, so the assertion mounting point and positioning here are not just "whether there is an element".
 *
 * False DOM only implements the members used by this module (jsdom is not quoted): class is represented by Set.
 * `style` is an ordinary object. The elements are not typeset, and the width and height are directly given.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { disposeTip, TIP_CLASS, tipAttrs } from './tooltip.ts';

/** Minimalist element stand-in: `parentNode` is connected to `remove()`, used to verify "attached to body/removed from body". */
class FakeEl {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  textContent = '';
  /** False DOM has no typesetting: the width and height are fixed, and the real size is available for positioning calculation. */
  offsetWidth = 80;
  offsetHeight = 26;

  constructor(tag: string) {
    this.tag = tag;
  }

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
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const bucket = this.listeners.get(type) ?? new Set<() => void>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** The number of currently hanging monitors of this type (used to verify that they are indeed removed when unmounting). */
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

/** Minimalist document stand-in + viewport size. */
class FakeWindow extends FakeTarget {
  innerWidth = 1280;
  innerHeight = 800;
}

/** Minimalist document stand-in. */
class FakeDocument extends FakeTarget {
  readonly body = new FakeEl('body');

  createElement(tag: string): FakeEl {
    return new FakeEl(tag);
  }
}

/** Install a fake global, return document and restore function. */
function withFakeDom(): { doc: FakeDocument; win: FakeWindow; restore: () => void } {
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = win;
  return {
    doc,
    win,
    restore: () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    },
  };
}

/** The bubble currently hanging on body (acknowledged by class, does not rely on subscripts). */
function tips(doc: FakeDocument): FakeEl[] {
  return doc.body.children.filter((el) => el.attrs.get('class') === TIP_CLASS);
}

afterEach(() => {
  disposeTip();
});

describe('tipAttrs - body layer bubble on hover', () => {
  test('Cursor entry: Create a tooltip bubble on body, with the text and visible state in place', () => {
    const { doc, restore } = withFakeDom();
    try {
      const attrs = tipAttrs('播放这句');
      attrs.onMouseEnter({ clientX: 100, clientY: 100 });

      const bubble = tips(doc);
      assert.equal(
        bubble.length,
        1,
        'The bubble should be hung on body (the list is a scrolling container and will be cropped if hung inside)',
      );
      assert.equal(bubble[0].attrs.get('role'), 'tooltip');
      assert.equal(bubble[0].textContent, '播放这句');
      assert.equal(bubble[0].classList.contains('is-on'), true);
    } finally {
      restore();
    }
  });

  test('Positioning: Place the cursor in the lower right corner as long as it fits, with a gap of 10 px', () => {
    const { doc, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      const bubble = tips(doc)[0];
      assert.equal(bubble.style.left, '110px');
      assert.equal(bubble.style.top, '110px');
    } finally {
      restore();
    }
  });

  test('Positioning: When the cursor is attached to the lower right corner, it flips to the upper left corner of the cursor and does not extend out of the viewport.', () => {
    const { doc, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 1270, clientY: 790 });
      const bubble = tips(doc)[0];
      // 1270 - 10 - 80 = 1180；790 - 10 - 26 = 754
      assert.equal(bubble.style.left, '1180px');
      assert.equal(bubble.style.top, '754px');
    } finally {
      restore();
    }
  });

  test('Cursor leaves: only the elements are shown and hidden, and the element remains reuse (hovering frequently, repeated creation and deletion will cause it to flash)', () => {
    const { doc, restore } = withFakeDom();
    try {
      const attrs = tipAttrs('点开看大图');
      attrs.onMouseEnter({ clientX: 100, clientY: 100 });
      attrs.onMouseLeave();

      const bubble = tips(doc);
      assert.equal(bubble.length, 1);
      assert.equal(bubble[0].classList.contains('is-on'), false);
    } finally {
      restore();
    }
  });

  test('Change the trigger element and then hover: reuse the same bubble and replace the text with the new one', () => {
    const { doc, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      tipAttrs('点开看大图').onMouseEnter({ clientX: 200, clientY: 100 });

      const bubble = tips(doc);
      assert.equal(bubble.length, 1);
      assert.equal(bubble[0].textContent, '点开看大图');
    } finally {
      restore();
    }
  });

  test('After scrolling or being pressed: the bubble is immediately folded (fixed positioning will not follow the content, and will be misaligned if left on)', () => {
    const { doc, win, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      win.fire('scroll');
      assert.equal(tips(doc)[0].classList.contains('is-on'), false);

      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      doc.fire('pointerdown');
      assert.equal(tips(doc)[0].classList.contains('is-on'), false);
    } finally {
      restore();
    }
  });

  test('If you don’t answer focus: Clicking the button will also gain focus. If you answer it, a bubble will remain in the big picture/during playback that cannot be removed.', () => {
    const attrs = tipAttrs('播放这句');
    assert.deepEqual(Object.keys(attrs).sort(), ['onMouseEnter', 'onMouseLeave']);
  });
});

describe('disposeTip —— unmount recycling', () => {
  test('Remove the bubble and global monitor, and then re-hover to create another one.', () => {
    const { doc, win, restore } = withFakeDom();
    try {
      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      assert.equal(win.count('scroll'), 1);
      assert.equal(doc.count('pointerdown'), 1);

      disposeTip();
      assert.equal(tips(doc).length, 0, 'bubble should be removed from body');
      assert.equal(win.count('scroll'), 0);
      assert.equal(doc.count('pointerdown'), 0);

      tipAttrs('播放这句').onMouseEnter({ clientX: 100, clientY: 100 });
      assert.equal(tips(doc).length, 1, 'unmount is only for recycling, not deactivation.');
      assert.equal(win.count('scroll'), 1, 'Monitoring cannot be superimposed repeatedly.');
    } finally {
      restore();
    }
  });

  test('Unmount if it is not displayed: no element will be created and no error will be reported', () => {
    const { doc, restore } = withFakeDom();
    try {
      disposeTip();
      assert.equal(doc.body.children.length, 0);
    } finally {
      restore();
    }
  });
});
