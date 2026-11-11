/**
 * Click points pop-up window and particle burst: both ends share the same rendering. Pure logic (threshold and score
 * mapping) in score.ts, this file is only for display - particles explode at the click, the pop-up window displays + N
 * points and speed/size details, click outside or Esc to close immediately.
 * @module dsh-pet/src/shared/score-popup
 */
import { clickScore, SCORE_MIN_SPEED } from './score.ts';

/** Pop-up window display duration (ms): Points feedback is shorter than bubble (10 s), which is enough to read. */
export const SCORE_POPUP_DURATION_MS = 2200;

/** Pop-up window style - the same portion is injected into both ends. */
export const SCORE_POPUP_CSS = [
  '.dsh-pet-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;',
  'background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;',
  'box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;',
  // The font family uses global configuration variables (both ends are injected into documentElement): the pop-up
  // window is hung under body and cannot be inherited from the pet root container. Fixed font size px - The configured
  // font.size only works on bubbles and floating prompts.
  "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);}",
  '.dsh-pet-score.is-in{animation:dshPetScorePop .28s ease}',
  '.dsh-pet-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}',
  '.dsh-pet-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}',
  // Particle layer: The whole screen is fixed and interaction is not blocked; the particles are absolutely positioned small dots, and the displacement and transparency are directly written by rAF
  '.dsh-pet-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}',
  '.dsh-pet-score-particle{position:absolute;border-radius:50%;pointer-events:none}',
  '@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}',
].join('');

/** The style is only injected once (same as the injection mode of CHAT_CSS). */
let scoreCssInjected = false;
function injectScoreCss(): void {
  if (scoreCssInjected || typeof document === 'undefined') return;
  scoreCssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = 'dsh-pet/score';
  tag.textContent = SCORE_POPUP_CSS;
  document.head.appendChild(tag);
}

/** Number of particles. */
const BURST_COUNT = 20;
/** Initial velocity range (px/s). */
const BURST_SPEED_MIN = 120;
const BURST_SPEED_MAX = 460;
/** Gravity (px/s²): particles fallback after being ejected upward. */
const BURST_GRAVITY = 700;
/** Single particle lifetime range (ms). */
const BURST_LIFE_MIN = 500;
const BURST_LIFE_MAX = 900;
/** Particle radius range (px). */
const BURST_RADIUS_MIN = 3;
const BURST_RADIUS_MAX = 7;
/** Warm color palette (points and sense of celebration). */
const BURST_COLORS = ['#ffb300', '#ff8f00', '#ff7043', '#f4511e', '#ffc400', '#ffd54f', '#ef5350'];

/**
 * Explode a circle of warm-colored particles (viewport coordinates) at ( x , y ): random direction initial velocity +
 * gravity fallback + fade out, and overall cleanup at the end of life. Skip when prefers-reduced-motion (same
 * semantics as Q).
 */
export function spawnScoreBurst(x: number, y: number): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  injectScoreCss();
  const root = document.createElement('div');
  root.className = 'dsh-pet-score-burst';
  document.body.appendChild(root);
  interface P {
    el: HTMLDivElement;
    vx: number;
    vy: number;
    t0: number;
    life: number;
  }
  const parts: P[] = [];
  for (let i = 0; i < BURST_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);
    const r = BURST_RADIUS_MIN + Math.random() * (BURST_RADIUS_MAX - BURST_RADIUS_MIN);
    const el = document.createElement('div');
    el.className = 'dsh-pet-score-particle';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = r * 2 + 'px';
    el.style.height = r * 2 + 'px';
    el.style.background = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
    root.appendChild(el);
    parts.push({
      el,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 80,
      t0: performance.now(),
      life: BURST_LIFE_MIN + Math.random() * (BURST_LIFE_MAX - BURST_LIFE_MIN),
    });
  }
  const step = (): void => {
    const now = performance.now();
    let alive = false;
    for (const p of parts) {
      const tSec = (now - p.t0) / 1000;
      const lifeRatio = (now - p.t0) / p.life;
      if (lifeRatio >= 1) continue;
      alive = true;
      // Analytical trajectory: x = vx · t, y = vy · t + ½ g · t ² (no need to accumulate frame by frame to avoid frame loss and drift)
      p.el.style.transform =
        'translate(' + p.vx * tSec + 'px,' + (p.vy * tSec + 0.5 * BURST_GRAVITY * tSec * tSec) + 'px)';
      p.el.style.opacity = String(Math.max(0, 1 - lifeRatio));
    }
    if (alive) requestAnimationFrame(step);
    else root.remove();
  };
  requestAnimationFrame(step);
}

/** Points pop-up window mount handle (same contract as mountChatDialog). */
export interface ScorePopupMount {
  /** Root element (under document.body) */
  el: HTMLElement;
  /** Close and clean up (idempotent) */
  close: () => void;
}

/**
 * Mount click points pop-up window: display + N points and speed/size details, disappear automatically after
 * SCORE_POPUP_DURATION_MS, click outside or Esc to close. The position is the coordinates of the viewport, and it will
 * be automatically clipped back when it exceeds the viewport; the score is calculated and passed in by the caller
 * using clickScore.
 */
export function mountScorePopup(opts: {
  x: number;
  y: number;
  score: number;
  speed: number;
  size: number;
  /** Notification after closing (caller resets its own state) */
  onClose?: () => void;
}): ScorePopupMount {
  injectScoreCss();
  // The pop-up window is displayed above the click point (avoiding the finger/cursor) and is clipped beyond the viewport.
  const x = opts.x;
  const y = opts.y;
  const root = document.createElement('div');
  root.className = 'dsh-pet-score';

  const val = document.createElement('div');
  val.className = 'dsh-pet-score-val';
  val.textContent = '+' + opts.score;
  const sub = document.createElement('div');
  sub.className = 'dsh-pet-score-sub';
  sub.textContent = '速度 ' + Math.round(opts.speed) + ' · 大小 ' + Math.round(opts.size);
  root.appendChild(val);
  root.appendChild(sub);
  document.body.appendChild(root);

  // Positioning (measure first and then position; same as mountChatDialog)
  const rr = root.getBoundingClientRect();
  root.style.left = Math.max(4, Math.min(x - rr.width / 2, window.innerWidth - rr.width - 4)) + 'px';
  root.style.top = Math.max(4, y - rr.height - 14) + 'px';
  // Add animation class after forced rearrangement to ensure that the entrance animation is visible
  void root.offsetWidth;
  root.classList.add('is-in');

  let closed = false;
  let timer: number | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    document.removeEventListener('mousedown', onDocPointerDown, true);
    document.removeEventListener('keydown', onDocKeyDown, true);
    root.remove();
    if (opts.onClose) opts.onClose();
  };
  // Mounting grace period: The pop-up window is triggered by pointerdown (click to pop up). After the same event, the
  // browser will also dispatch the compatible mousedown; without a grace period, the newly mounted pop-up window will
  // be closed on the spot by its own "off-click close", so only the first mousedown after mounting is swallowed.
  const mountedAt = performance.now();
  let graceConsumed = false;
  const onDocPointerDown = (e: MouseEvent): void => {
    if (closed) return;
    if (!graceConsumed) {
      graceConsumed = true;
      if (e.timeStamp - mountedAt < 300) return; // Compatible mousedown pressed at the same time: ignored
    }
    if (root.contains(e.target as Node)) return;
    close();
  };
  const onDocKeyDown = (e: KeyboardEvent): void => {
    if (closed) return;
    if (e.key === 'Escape') close();
  };
  document.addEventListener('mousedown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);
  timer = window.setTimeout(close, SCORE_POPUP_DURATION_MS);
  return { el: root, close };
}

// Transfer out fractional constant, no need to add caller import score.ts
export { clickScore, SCORE_MIN_SPEED };
