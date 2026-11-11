/**
 * Whisper sharing contract test - verify the parsing semantics of "text + optional image" and the rendering of images
 * shared by both ends:
 * - image missing/blank/non-character string → do not generate this field (old behavior: plain text whisper);
 * - When the name contains Chinese, URL must be encoded (host side decodeURIComponent followed by file name matching);
 * - Picture nodes and styles are provided by this module. The browser React shell and the desktop DOM shell each
 * reference the same constant.
 *
 * Running method: node --experimental-strip-types --test src/shared/whisper.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEME_BUBBLE_CLASS,
  MEME_BUBBLE_CSS,
  MEME_IMG_CLASS,
  createMemeImage,
  createMemeImageFromUrl,
  memeImageUrl,
} from './whisper.ts';

describe('memeImageUrl —— emoticon picture address', () => {
  test('The Chinese name is encoded by URL (the route section only recognizes the encoded form)', () => {
    assert.equal(
      memeImageUrl('鱼片有资源吗'),
      '/dsh-pet-7340/pic/memes/' + encodeURIComponent('鱼片有资源吗') + '.png',
    );
    assert.ok(!memeImageUrl('鱼片有资源吗').includes('鱼片'));
  });

  test('Leave the pure ASCII name as it is to facilitate visual inspection.', () => {
    assert.equal(memeImageUrl('Ciallo'), '/dsh-pet-7340/pic/memes/Ciallo.png');
  });

  test('Go to the pic/memes prefix (host route maps assets/memes according to this prefix)', () => {
    assert.ok(memeImageUrl('可爱').startsWith('/dsh-pet-7340/pic/memes/'));
    assert.ok(memeImageUrl('可爱').endsWith('.png'));
  });

  test('base semantics = already contains/host base address of dsh-pet-7340 (consistent with video assetBase)', () => {
    // Desktop bridge mode: pass BASE itself (it already contains / dsh-pet-7340), and must not be spelled again
    assert.equal(
      memeImageUrl('可爱', 'dsh-pet-bridge://dsh-pet/dsh-pet-7340'),
      'dsh-pet-bridge://dsh-pet/dsh-pet-7340/pic/memes/' + encodeURIComponent('可爱') + '.png',
    );
    // Desktop HTTP direct connection mode: Same as above
    assert.equal(
      memeImageUrl('可爱', 'http://127.0.0.1:8080/dsh-pet-7340'),
      'http://127.0.0.1:8080/dsh-pet-7340/pic/memes/' + encodeURIComponent('可爱') + '.png',
    );
    // Browser default: relative path (the page itself is on host origin)
    assert.equal(memeImageUrl('可爱'), '/dsh-pet-7340/pic/memes/' + encodeURIComponent('可爱') + '.png');
  });

  test('Duplicate / dsh-pet-7340 segments are not allowed (the cause of desktop image cracks)', () => {
    for (const base of ['dsh-pet-bridge://dsh-pet/dsh-pet-7340', 'http://127.0.0.1:8080/dsh-pet-7340']) {
      const url = memeImageUrl('可爱', base);
      assert.equal(url.split('/dsh-pet-7340').length - 1, 1, url);
    }
    assert.equal(memeImageUrl('可爱').split('/dsh-pet-7340').length - 1, 1);
  });

  test('With asset root → one more section <asset root> (the picture belongs to the same set as the animation: press the asset root to get the directory chain)', () => {
    assert.equal(
      memeImageUrl('可爱', '/dsh-pet-7340', 'test1'),
      '/dsh-pet-7340/pic/memes/test1/' + encodeURIComponent('可爱') + '.png',
    );
    // Chinese asset roots have the same encoding
    assert.equal(
      memeImageUrl('可爱', '/dsh-pet-7340', '小不点'),
      '/dsh-pet-7340/pic/memes/' + encodeURIComponent('小不点') + '/' + encodeURIComponent('可爱') + '.png',
    );
    // Desktop: base already contains the prefix, only add one paragraph to the asset root
    assert.equal(
      memeImageUrl('可爱', 'http://127.0.0.1:8080/dsh-pet-7340', 'pack1'),
      'http://127.0.0.1:8080/dsh-pet-7340/pic/memes/pack1/' + encodeURIComponent('可爱') + '.png',
    );
    assert.equal(memeImageUrl('可爱', '/dsh-pet-7340', 'pack1').split('/dsh-pet-7340').length - 1, 1);
  });

  test('asset root default/blank → return to the old two-segment form (= directory chain of asset root main, so as not to break the picture)', () => {
    const flat = memeImageUrl('可爱');
    for (const root of ['', '   ', undefined]) {
      assert.equal(memeImageUrl('可爱', '/dsh-pet-7340', root), flat);
    }
    assert.equal(
      memeImageUrl('可爱', undefined, 'main'),
      '/dsh-pet-7340/pic/memes/main/' + encodeURIComponent('可爱') + '.png',
    );
  });
});

describe('createMemeImage - Graphic node shared by both ends', () => {
  /** Minimum DOM pile: the shared function only uses document.createElement (there is no DOM in Node) */
  function stubDocument(): { created: { tag: string; props: Record<string, string> }[]; restore: () => void } {
    const created: { tag: string; props: Record<string, string> }[] = [];
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    g.document = {
      createElement(tag: string) {
        const rec = { tag, props: {} as Record<string, string> };
        created.push(rec);
        return {
          dataset: {} as Record<string, string>,
          textContent: '',
          set className(v: string) {
            rec.props.className = v;
          },
          set src(v: string) {
            rec.props.src = v;
          },
          set alt(v: string) {
            rec.props.alt = v;
          },
        };
      },
      querySelector: () => null, // It is considered that the style has not been injected → take the injection branch
      head: { appendChild: () => {} },
    };
    return {
      created,
      restore: () => {
        g.document = prev;
      },
    };
  }

  test('Name is missing/blank → null (the caller takes the plain text path accordingly)', () => {
    for (const v of [undefined, '', '   ']) {
      assert.equal(createMemeImage(v), null);
    }
  });

  test('has name → outputs img, class/src/alt complete', () => {
    const doc = stubDocument();
    try {
      createMemeImage('死掉了');
      assert.equal(doc.created.filter((c) => c.tag === 'img').length, 1);
      const img = doc.created.find((c) => c.tag === 'img');
      assert.equal(img?.props.className, MEME_IMG_CLASS);
      assert.equal(img?.props.src, memeImageUrl('死掉了'));
      assert.equal(img?.props.alt, '死掉了');
    } finally {
      doc.restore();
    }
  });

  test('Desktop transfer BASE → src is an absolute address (file:// page must be absolute and have the same rules as the video)', () => {
    const doc = stubDocument();
    const base = 'http://127.0.0.1:8080/dsh-pet-7340';
    try {
      createMemeImage('可爱', base);
      const img = doc.created.find((c) => c.tag === 'img');
      assert.equal(img?.props.src, memeImageUrl('可爱', base));
      assert.equal(
        img?.props.src,
        'http://127.0.0.1:8080/dsh-pet-7340/pic/memes/' + encodeURIComponent('可爱') + '.png',
      );
    } finally {
      doc.restore();
    }
  });

  test('createMemeImage transparently transmits the asset root (on the desktop, press the pet to get your own meme directory)', () => {
    const doc = stubDocument();
    try {
      createMemeImage('可爱', 'http://127.0.0.1:8080/dsh-pet-7340', 'pack1');
      const img = doc.created.find((c) => c.tag === 'img');
      assert.equal(img?.props.src, memeImageUrl('可爱', 'http://127.0.0.1:8080/dsh-pet-7340', 'pack1'));
    } finally {
      doc.restore();
    }
  });

  test('createMemeImageFromUrl - url form directly uses the complete address (no spelling of the meme path, no need for BASE)', () => {
    const doc = stubDocument();
    try {
      createMemeImageFromUrl('https://cdn.example.com/拒绝换壁纸.png');
      assert.equal(doc.created.filter((c) => c.tag === 'img').length, 1);
      const img = doc.created.find((c) => c.tag === 'img');
      // Shares the same style as the name form class (the bubble is canceled by it min-width)
      assert.equal(img?.props.className, MEME_IMG_CLASS);
      assert.equal(img?.props.src, 'https://cdn.example.com/拒绝换壁纸.png');
    } finally {
      doc.restore();
    }
  });

  test('createMemeImageFromUrl ——The address is missing/blank → null (the caller takes the plain text path accordingly)', () => {
    for (const v of [undefined, '', '   ']) {
      assert.equal(createMemeImageFromUrl(v), null);
    }
  });

  test('The two forms do not interfere with each other: url form will never spell / pic/memes (even if the address contains the same file name)', () => {
    const doc = stubDocument();
    try {
      createMemeImageFromUrl('https://cdn.example.com/可爱.png');
      const img = doc.created.find((c) => c.tag === 'img');
      assert.ok(!String(img?.props.src).includes('/pic/memes/'));
    } finally {
      doc.restore();
    }
  });

  test('Selectors/variables at both ends are written in shared (to avoid aliasing in the browser and desktop)', () => {
    assert.ok(MEME_BUBBLE_CSS.includes('.' + MEME_IMG_CLASS));
    assert.ok(MEME_BUBBLE_CSS.includes('.' + MEME_BUBBLE_CLASS));
    // The size is compatible with variable names at both ends: browser --dsh-pet-size, desktop --pet-size
    assert.ok(MEME_BUBBLE_CSS.includes('--dsh-pet-size'));
    assert.ok(MEME_BUBBLE_CSS.includes('--pet-size'));
  });
});
