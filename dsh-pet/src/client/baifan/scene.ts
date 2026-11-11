/**
 * The rice layer of "eating white rice": falling, falling loop, flying to the mouth, empty bowl and score bubble.
 *
 * Self-sustaining DOM and rAF (the falling object only runs when something is still in the sky), does not touch the
 * interface and does not judge the performance phase - the phase belongs to show, here only answers "what is on the
 * field, which one is closest".
 * @module dsh-pet/src/client/baifan/scene
 */
import { CFG, PIC } from './constants.ts';
import { groundLine, type Geometry } from './geometry.ts';
/** A meal on the field. */
export interface RiceItem {
  /** Element. */
  el: HTMLImageElement;
  /** Viewport center x. */
  x: number;
  /** Bottom edge y. */
  y: number;
  /** Render wide. */
  w: number;
  /** Rendering high. */
  h: number;
  /** A bowl of rice or a rice ball. */
  type: 'bowl' | 'ball';
  /** Falling speed (pixels/second). */
  vy: number;
  /** Current rotation angle (degrees). */
  rot: number;
  /** Rotation speed (degrees/second). */
  spin: number;
  /** Status: Still landing / Landed. */
  state: 'falling' | 'ground';
}

/** Create an element. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

/**
 * Make rice layer.
 *
 * @param layer - The root node of the overlay layer (all elements of this layer are hung below it).
 * @param toastEl - prompt bar node; `toast()` write it directly.
 * @returns How to spawn, fall, fly, score and clear.
 */
export function createScene(layer: HTMLDivElement, toastEl: HTMLDivElement) {
  /** Meals on the field. */
  let items: RiceItem[] = [];
  /** rAF handle of fall cycle; 0 = not running. */
  let frame = 0;
  /** Last frame timestamp (seconds). */
  let lastMs = 0;
  /** Fade out timer of prompt bar. */
  let toastTimer = 0;

  /**
   * The prompt bar is centered at the bottom and fades out after 1.8 seconds.
   *
   * @param text - Copywriter.
   */
  function toast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /** Write style according to current coordinates. */
  function layout(item: RiceItem): void {
    item.el.style.left = item.x - item.w / 2 + 'px';
    item.el.style.top = item.y - item.h + 'px';
    item.el.style.transform = 'rotate(' + item.rot + 'deg)';
  }

  /**
   * A meal falls from the sky. The position is random in the viewport (leave 70 px on the left and right), and the
   * size is scaled according to the sprite.
   *
   * @param scale - Scale of the sprite relative to the base width.
   * @returns A new copy; returns null when the field is full.
   */
  function spawn(scale: number): RiceItem | null {
    if (items.length >= CFG.maxRice) return null;
    const isBowl = Math.random() < CFG.bowlRatio;
    const w = (isBowl ? 124 : 110) * scale;
    const img = el('img');
    img.className = 'bf-rice';
    img.src = isBowl ? PIC.bowlFull : PIC.riceBall;
    img.alt = '';
    img.draggable = false;
    img.style.width = w + 'px';
    img.style.height = w + 'px';
    const item: RiceItem = {
      el: img,
      x: 70 + Math.random() * Math.max(10, window.innerWidth - 140),
      y: -w - 20,
      w,
      h: w,
      type: isBowl ? 'bowl' : 'ball',
      vy: 170 + Math.random() * 60,
      rot: 0,
      spin: isBowl ? 0 : (Math.random() < 0.5 ? -1 : 1) * 90,
      state: 'falling',
    };
    layer.appendChild(img);
    items.push(item);
    layout(item);
    return item;
  }

  /**
   * Fall cycle: run rAF only when there is something in the sky, and stop naturally after landing.
   *
   * @param ts - rAF Timestamp (milliseconds).
   */
  function fallTick(ts: number): void {
    frame = 0;
    if (!lastMs) lastMs = ts;
    const dt = Math.min((ts - lastMs) / 1000, 0.05);
    lastMs = ts;

    let falling = false;
    const line = groundLine();
    for (const item of items) {
      if (item.state !== 'falling') {
        if (item.rot !== 0) {
          item.rot = 0;
          layout(item);
        }
        continue;
      }
      falling = true;
      item.y += item.vy * dt;
      item.rot += item.spin * dt;
      if (item.y >= line) {
        item.y = line;
        item.state = 'ground';
        item.el.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.92)' }, { transform: 'scaleY(1)' }], {
          duration: 160,
          easing: 'ease-out',
        });
      }
      layout(item);
    }
    if (falling && frame === 0) frame = window.requestAnimationFrame(fallTick);
  }

  /** Pull up and down cycle on demand. */
  function kick(): void {
    if (frame === 0) frame = window.requestAnimationFrame(fallTick);
  }

  /**
   * The closest meal on the field that has landed.
   *
   * "Recently" brings a little orientation preference: the one behind you needs to be discounted to count - changing
   * the orientation requires restarting a running animation (the new video needs to be decoded). There must be a gap
   * at that time, so if you can't, don't change it.
   *
   * @param petPx - Pet Center x.
   * @param facing - Current heading.
   * @returns is the chosen portion; when there is no food that has landed on the field, it returns to null.
   */
  function nearest(petPx: number, facing: 'left' | 'right'): RiceItem | null {
    let best: RiceItem | null = null;
    let bestScore = Infinity;
    for (const item of items) {
      if (item.state !== 'ground') continue;
      const distance = Math.abs(item.x - petPx);
      const ahead = facing === 'right' ? item.x > petPx : item.x < petPx;
      const score = ahead ? distance : distance * CFG.backTurnPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  /** Remove a piece of rice from the field (the element is handed over to the caller to decide when to delete it). */
  function detach(item: RiceItem): void {
    const index = items.indexOf(item);
    if (index >= 0) items.splice(index, 1);
  }

  /**
   * Eat one portion: fly to your mouth, shrink with chewing, and delete elements when it reaches the point.
   *
   * @param item - the portion that was eaten (caller should be detach).
   * @param mouthX - Mouth viewport x.
   * @param mouthY - Mouth viewport y.
   * @param durationMs - flight duration (use real film length to synchronize with chewing).
   */
  function flyToMouth(item: RiceItem, mouthX: number, mouthY: number, durationMs: number): void {
    const dx = mouthX - item.x;
    const dy = mouthY - (item.y - item.h / 2);
    item.el.style.zIndex = '5';
    // Shrink the food to 0.72 at the end of the flight: if the entire original size is placed on the face, the eyes
    // will be covered. transform-origin is 50% 100% (bottom), so the scaling is "from bottom to top" and will not
    // shrink higher and higher.
    item.el.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.72)', opacity: 1, offset: 0.16 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.68)', opacity: 1, offset: 0.55 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.12)', opacity: 0, offset: 1 },
      ],
      { duration: durationMs, easing: 'ease-in-out', fill: 'forwards' },
    );
    window.setTimeout(() => item.el.remove(), durationMs + 80);
  }

  /**
   * Empty bowl: falls from the mouth to the ground, bounces twice, then fades out.
   *
   * @param x - Mouth viewport x.
   * @param fromY - Mouth viewport y (the bottom of the bowl is placed here first).
   * @param scale - Sprite scaling.
   */
  function dropEmptyBowl(x: number, fromY: number, scale: number): void {
    const w = 124 * scale;
    const img = el('img');
    img.className = 'bf-rice';
    img.src = PIC.bowlEmpty;
    img.alt = '';
    img.draggable = false;
    img.style.width = w + 'px';
    img.style.height = w + 'px';
    img.style.left = x - w / 2 + 'px';
    img.style.top = fromY - w + 'px';
    layer.appendChild(img);

    const drop = Math.max(0, groundLine() - fromY);
    img.animate(
      [
        { transform: 'translateY(0)' },
        { transform: 'translateY(' + drop + 'px)', offset: 0.48, easing: 'ease-in' },
        { transform: 'translateY(' + (drop - 42 * scale) + 'px)', offset: 0.62, easing: 'ease-out' },
        { transform: 'translateY(' + drop + 'px)', offset: 0.74, easing: 'ease-in' },
        { transform: 'translateY(' + (drop - 14 * scale) + 'px)', offset: 0.82, easing: 'ease-out' },
        { transform: 'translateY(' + drop + 'px)', offset: 0.9 },
        { transform: 'translateY(' + drop + 'px)', offset: 1 },
      ],
      { duration: 820, easing: 'linear' },
    );
    window.setTimeout(() => {
      img.style.transition = 'opacity .9s ease';
      img.style.opacity = '0';
      window.setTimeout(() => img.remove(), 950);
    }, 900);
  }

  /**
   * Score bubble above the head: The icon changes with the portion of rice just eaten (bowl of rice/rice ball).
   *
   * @param value - Cumulative number of copies.
   * @param type - Just eaten.
   * @param geom - the current geometric quantity (determines the bubble position).
   */
  function popScore(value: number, type: 'bowl' | 'ball', geom: Geometry): void {
    const isBowl = type === 'bowl';
    const node = el('div');
    node.className = 'bf-score';
    node.innerHTML =
      '<img class="' +
      (isBowl ? 'bowl' : 'ball') +
      '" src="' +
      (isBowl ? PIC.bowlFull : PIC.riceBall) +
      '" alt="">' +
      '<span class="num">' +
      value +
      '</span>' +
      '<span class="plus">+1</span>';
    node.style.left = geom.cx + 'px';
    node.style.top = geom.top + geom.h * 0.09 + 'px';
    layer.appendChild(node);

    node.animate(
      [
        { opacity: 0, transform: 'translate(-50%,-100%) scale(.55)' },
        { opacity: 1, transform: 'translate(-50%,-100%) scale(1.16)', offset: 0.26 },
        { opacity: 1, transform: 'translate(-50%,-100%) scale(1)', offset: 0.5 },
        { opacity: 1, transform: 'translate(-50%,-100%) scale(1)', offset: 0.78 },
        { opacity: 0, transform: 'translate(-50%,-132%) scale(1)', offset: 1 },
      ],
      { duration: 1300, easing: 'ease-out', fill: 'forwards' },
    );
    const plus = node.querySelector('.plus');
    if (plus !== null) {
      plus.animate(
        [
          { opacity: 0, transform: 'translateY(6px) scale(.8)' },
          { opacity: 1, transform: 'translateY(-4px) scale(1)', offset: 0.25 },
          { opacity: 1, transform: 'translateY(-10px) scale(1)', offset: 0.7 },
          { opacity: 0, transform: 'translateY(-18px) scale(1)' },
        ],
        { duration: 1000, easing: 'ease-out', fill: 'forwards' },
      );
    }
    window.setTimeout(() => node.remove(), 1350);
  }

  /** At the end of the game, clear the food on the field and stop the body circulation. */
  function clear(): void {
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    lastMs = 0;
    for (const item of items) {
      const node = item.el;
      node.style.transition = 'opacity .5s ease';
      node.style.opacity = '0';
      window.setTimeout(() => node.remove(), 520);
    }
    items = [];
  }

  return {
    clear,
    detach,
    dropEmptyBowl,
    flyToMouth,
    kick,
    nearest,
    popScore,
    /** There are still a few copies on the field (the caller decides whether to continue dropping based on this). */
    count: (): number => items.length,
    /** To scale the elves to the size of rice, use: Convert based on the base width (large pets are paired with a large plate of rice, and do not clip to 1). */
    scaleOf: (spriteW: number): number => (spriteW > 0 ? spriteW / CFG.refWidth : 1),
    spawn,
    toast,
  };
}

/** The open side of the rice layer. */
export type Scene = ReturnType<typeof createScene>;
