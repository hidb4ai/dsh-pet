/**
 * Q elastic squeeze: the front video is flattened to the ground and then rebounds. The curve is at `shared/physics`
 * (`squashScale`), and this module only deals with rAF and token. Only run one at the same time: the new one will
 * cancel the previous one and discard the late frames using the generation number to avoid two squeezes and grabbing
 * `transform` from each other. Respect the system's "reduce motion effect": no squeezing when hitting, but the
 * interface remains normal.
 * @module dsh-pet/src/client/pet/motion/squash
 */
import { SQ_DURATION_MS, SQ_SQUASH, squashScale } from '../../../shared/physics.ts';

/** Squeeze driver: one instance per pet. */
export interface SquashDriver {
  /** squeeze once; `depth` defaults to a shared constant (the landing impact will give a deeper value according to the falling speed). */
  start: (el: HTMLVideoElement, depth?: number) => void;
  /** Immediately reset and abandon the ongoing session. */
  stop: () => void;
}

/**
 * Create extrusion drive.
 *
 * @param o - Collection of value functions: `facing` gives the current orientation, and the mirror image should be
 * retained, so press it after squeezing to restore `transform` .
 * @returns Extrusion driver that can be called repeatedly.
 */
export function createSquashDriver(o: { facing: () => 'left' | 'right' }): SquashDriver {
  /** rAF in progress; `null` = no squeeze running. */
  let frame: number | null = null;
  /** Generation number: +1 for each start or stop, and late frames are discarded accordingly. */
  let token = 0;

  const stop = (): void => {
    token += 1;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  const start = (el: HTMLVideoElement, depth: number = SQ_SQUASH): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    token += 1;
    const current = token;
    if (frame !== null) cancelAnimationFrame(frame);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = (): void => {
      if (token !== current) return;
      const u = Math.min((performance.now() - t0) / SQ_DURATION_MS, 1);
      const scale = squashScale(u, depth);
      el.style.transform = (o.facing() === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      frame = null;
      el.style.transformOrigin = origin;
      // Restore pure mirroring; if transform was reset during the source change, the mirroring shall prevail.
      el.style.transform = o.facing() === 'right' ? 'scaleX(-1)' : '';
    };
    frame = requestAnimationFrame(step);
  };

  return { start, stop };
}
