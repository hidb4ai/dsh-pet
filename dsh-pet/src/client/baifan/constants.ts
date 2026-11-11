/**
 * Freeloader constants: tempo parameters, line pools, and overlay styles.
 *
 * Lines and rhythm are part of the gameplay and are not open to configuration; which 5 animations are used is
 * determined by animations.baifan. The address is spelled out in ./assets by "asset root + animation name", which is
 * the same as other animations in this plugin.
 * @module dsh-pet/src/client/baifan/constants
 */

/** Interface base address (same origin as the page). */
export const ROUTE = '/dsh-pet-7340';

/** Menu owner: has the same name as the original extension. Users who have installed old extensions will not have a duplicate item after upgrading. */
export const OWNER = 'dsh-pet-baifan';

/** Menu item copy; host returns clicks according to the copy, which is part of the agreement. */
export const LABEL = '吃白饭';

/** How to play id: corresponds to animations .< id > in the configuration. */
export const ACTIVITY = 'baifan';

/** The image asset that comes with the gameplay (assets/pic/baifan in the package): rice and empty bowl, is not an animation name and does not change with the configuration. */
export const PIC = {
  bowlFull: ROUTE + '/pic/baifan/bowl-full.png',
  bowlEmpty: ROUTE + '/pic/baifan/bowl-empty.png',
  riceBall: ROUTE + '/pic/baifan/rice-ball.png',
} as const;

/**
 * All adjustable rhythm.
 *
 * The coordinates are always calculated using **viewport pixels**, and are only normalized to 0–1 when adjusting the
 * interface - pose() returns the normalized center point, and rice and bubbles must be drawn on the page in pixels,
 * and it is enough to convert both sides back and forth once. Note that there is no "How long is the asset" here: when
 * the animation ends, a receipt of GET /playback /{ id } will be asked, and no timer will be used.
 */
export const CFG = {
  groundOffset: 26,
  prepMs: 2100,
  travelMs: 5000,
  runSpeed: 290,
  patrolSpeedRatio: 0.72,
  spawnMs: 4200,
  bowlRatio: 0.38,
  maxRice: 2,
  eatPx: 40,
  arrivePx: 12,
  tripMaxMs: 4500,
  sideWatchMs: 400,
  idleMs: 140,
  animLeadMs: 300,
  backTurnPenalty: 1.8,
  pollLatencyMs: 1000,
  preRollSec: 0.35,
  lockTtl: 30000,
  lockWaitMs: 25000,
  renewMs: 6000,
  flyFallbackMs: 5200,
  waitBudgetMs: 30000,
  httpTimeoutMs: 20000,
  bubbleMs: 2400,
  footRatio: 0.894,
  mouthRatio: 0.63,
  mouthDx: -0.03,
  refWidth: 498,
} as const;

/** Line pool: Only say one line at the right beat, and shut up the rest of the time, otherwise the bubble will get lost in the performance. */
export const LINES = {
  start: ['开饭了——', '白饭时间到！', '饿了饿了饿了'],
  down: ['等我下去……', '下面有饭香', '让一让，我下去了'],
  expect: ['饭呢？饭呢？', '快点快点', '……还没好吗'],
  drop: ['掉下来了！', '接住！', '来了来了'],
  bowl: ['碗饭最香', '这个碗我要了', '再来一碗'],
  ball: ['饭团饭团', '一口一个', '捏得刚好'],
  full: ['嗝——还能吃！', '这点不够塞牙缝', '再来十份'],
} as const;

/** Stylesheet deduplicate tag (consistent with data-plugin-css convention of dsh-pet). */
export const STYLE_TAG = 'dsh-pet-baifan/baifan.css';

/** The root node of the overlay layer is id. Press it to remove the old one when mounting again. */
export const ROOT_ID = 'dsh-pet-baifan-root';

/** The overlay is laminated on the desktop pet (desktop pet `.dsh-pet-root` is z-index:40); only this layer of relationship is guaranteed. */
const Z_INDEX = 50;

/** Overlay and rice, fraction style. */
export const CSS = [
  // The overlay is hosted by the shell.overlay slot ([data-shell-overlay] of AppFrame, z-index:20), not a direct child
  // of body: host written to macOS body > : not (# root ){ no-drag } It cannot be hit, so it is not declared here.
  // - webkit-app-region - That statement will generate a no-drag exclusion area covering the entire window on Windows,
  // and drag the title bar to remove the entire strip (#323 / #324).
  '#dsh-pet-baifan-root{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:' + Z_INDEX + '}',
  '.bf-rice{position:absolute;transform-origin:50% 100%;will-change:transform,opacity;',
  'user-select:none;-webkit-user-drag:none;pointer-events:none}',
  '.bf-score{position:absolute;display:flex;align-items:center;gap:6px;',
  'padding:5px 13px 5px 7px;border-radius:999px;white-space:nowrap;',
  'background:linear-gradient(180deg,#fff 0%,#e9f1fa 100%);',
  'border:1px solid rgba(23,64,107,.16);',
  'box-shadow:0 8px 22px rgba(23,64,107,.2),inset 0 1px 0 #fff;',
  'pointer-events:none;transform-origin:50% 100%}',
  '.bf-score img{width:26px;height:26px;object-fit:contain;display:block}',
  '.bf-score img.bowl{width:32px;height:22px}',
  '.bf-score .num{font-size:22px;font-weight:800;color:#17406b;line-height:1}',
  '.bf-score .plus{position:absolute;right:-6px;top:-10px;font-size:13px;font-weight:800;',
  'color:#e8825a;text-shadow:0 1px 0 #fff}',
  '.bf-toast{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);',
  'padding:8px 16px;border-radius:999px;font:13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;',
  'background:rgba(34,52,74,.88);color:#fff;opacity:0;transition:opacity .25s ease;pointer-events:none}',
  '.bf-toast.show{opacity:1}',
].join('');
