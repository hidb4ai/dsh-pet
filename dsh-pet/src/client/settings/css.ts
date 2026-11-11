/**
 * Setting page style sheet and injecting entry point: three family class names - `dsh-pet-mp__*` (AI model selector),
 * `dsh-pet-sel__*` (universal radio selection drop-down) and `dsh-pet-cfg__*` (configuration card). Only put pseudo
 * classes, suspension, transitions and container queries that cannot be expressed by inline style, and use component
 * inline style for the rest of the typesetting. The color and rounded corners are `--dsw-alias-*` / `--dsw-radius-*`
 * token; the white text and shadow fallback values on the fill button are intentional exceptions. Inject the
 * `data-plugin-css` deduplicate command, and the same page will not have a second copy of the style if it is
 * repeatedly rendered.
 * @module dsh-pet/src/client/settings/css
 */

/** Set the page style sheet; segment the text into a single paragraph by class name and family, and mark the counterintuitive rules in line comments. */
const SETTINGS_CSS = [
  '.dsh-pet-mp{position:relative;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dsh-pet-mp__trigger{display:flex;align-items:center;gap:6px;width:100%;max-width:340px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer;outline:none}',
  '.dsh-pet-mp__trigger:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-mp__trigger:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
  '.dsh-pet-mp__trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.dsh-pet-mp__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dsh-pet-mp__sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex-shrink:1000;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}',
  '.dsh-pet-mp__chevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));transition:transform .12s}',
  '.dsh-pet-mp__chevron.is-open{transform:rotate(180deg)}',
  // Use fixed to separate the floating layer from the scroll container of the settings page (not be cut off by overflow); z-index is in the same file as the plugin right-click menu.
  '.dsh-pet-mp__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:4px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-mp__search{box-sizing:border-box;width:100%;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}',
  '.dsh-pet-mp__search:focus{border-color:var(--dsw-alias-state-business-primary)}',
  // overflow-x must be explicit hidden: when only overflow-y is set, CSS will lift the visible of the other axis into
  // auto, and the entry is width:100 % + left and right padding, there will be 16 more px horizontally , so a useless
  // horizontal scroll bar appears.
  '.dsh-pet-mp__list{display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}',
  '.dsh-pet-mp__group{padding:6px 8px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-mp__item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
  '.dsh-pet-mp__item:hover:not(:disabled),.dsh-pet-mp__item.is-active{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-pet-mp__item[aria-checked="true"]{color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-mp__item:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.dsh-pet-mp__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dsh-pet-mp__check{flex:none;margin-left:auto}',
  '.dsh-pet-mp__status{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',

  // Universal radio-select drop-down: The trigger is superimposed on __inp, and only the layout that the buttons should have but not the input box is supplemented; the floating layer has the same appearance as the model selector above.
  '.dsh-pet-sel{position:relative;min-width:0}',
  '.dsh-pet-sel__trigger{display:flex;align-items:center;gap:6px;text-align:left;cursor:pointer}',
  '.dsh-pet-sel__trigger:disabled{cursor:default}',
  '.dsh-pet-sel__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  // The arrow uses a small triangle instead of character: it does not depend on the font, and the baseline when rotating is consistent with the folded card.
  '.dsh-pet-sel__chevron{flex:none;margin-left:auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;color:var(--dsw-alias-label-tertiary);transition:transform .12s}',
  '.dsh-pet-sel__chevron.is-open{transform:rotate(180deg)}',
  '.dsh-pet-sel__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:2px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-sel__list{display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}',
  '.dsh-pet-sel__item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
  '.dsh-pet-sel__item:hover:not(:disabled),.dsh-pet-sel__item.is-active{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-pet-sel__item[aria-selected="true"]{color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-sel__item:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
  '.dsh-pet-sel__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
  '.dsh-pet-sel__check{flex:none;margin-left:auto}',

  '.dsh-pet-cfg{container-type:inline-size;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
  '.dsh-pet-cfg__title{display:flex;align-items:center;gap:6px;margin:0;font-size:16px;font-weight:500;line-height:24px}',

  '.dsh-pet-cfg__card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}',
  '.dsh-pet-cfg__cardHead{display:flex;align-items:center;gap:6px;min-height:20px}',
  '.dsh-pet-cfg__cardTitle{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',

  // Folding card (advanced configuration/unmount and storage): the title line is permanent and the text is retracted
  // into the cropping layer. The gap of the card itself is reset to zero, and the spacing between the header and the
  // text is provided by the padding-top of the inner layer of the text - it disappears when it is folded, leaving no
  // gap at the bottom.
  '.dsh-pet-cfg__card.is-fold{gap:0}',
  '.dsh-pet-cfg__foldToggle{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;min-height:20px;padding:0;border:none;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}',
  '.dsh-pet-cfg__foldToggle:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
  // The arrow uses a small triangle instead of character: it does not depend on the font, indentation and line height.
  '.dsh-pet-cfg__chevron{flex:none;margin-left:auto;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;color:var(--dsw-alias-label-tertiary);transition:transform .12s}',
  '.dsh-pet-cfg__chevron.is-open{transform:rotate(180deg)}',
  '.dsh-pet-cfg__fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows .12s ease}',
  '.dsh-pet-cfg__card.is-open .dsh-pet-cfg__fold{grid-template-rows:1fr}',
  '.dsh-pet-cfg__foldClip{min-height:0;overflow:hidden}',
  '.dsh-pet-cfg__foldBody{display:flex;flex-direction:column;gap:10px;padding-top:10px}',

  '.dsh-pet-cfg__grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px;align-items:end}',
  '.dsh-pet-cfg__grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;align-items:end}',
  '.dsh-pet-cfg__grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;align-items:end}',

  '@container (max-width:600px){.dsh-pet-cfg__grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '@container (max-width:400px){.dsh-pet-cfg__grid2,.dsh-pet-cfg__grid3,.dsh-pet-cfg__grid4{grid-template-columns:minmax(0,1fr)}}',

  '.dsh-pet-cfg__field{display:flex;flex-direction:column;gap:4px;min-width:0}',
  '.dsh-pet-cfg__flabel{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary)}',

  // Top row: the avatar is the left column, and the right is a 2×2 input grid; the narrow container is reduced to a single column, and the avatar is back above the input.
  '.dsh-pet-cfg__topRow{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px 18px;align-items:stretch;margin-bottom:10px}',

  // The width of the avatar is fixed, and the height **fills the two rows on the right** - otherwise there will be a
  // large space under the avatar (the right column is much higher than 72 px). When it can be changed, the whole thing
  // is a button: the mask is floated, and the file box is opened directly by clicking on it. There is no independent
  // button.
  '.dsh-pet-cfg__avatarCol{position:relative;width:120px;flex:none}',
  '.dsh-pet-cfg__avatarImg{display:block;width:100%;height:100%;min-height:72px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);object-fit:cover;background:var(--dsw-alias-bg-layer-1)}',
  '.dsh-pet-cfg__avatarPick{position:relative;display:block;height:100%;border-radius:14px}',
  // The keyboard can reach: input covers the entire area and is transparent (display:none will make it unfocusable); focus is masked like suspension.
  '.dsh-pet-cfg__avatarPick:focus-within{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
  // Use token for masking, and fall back to translucent black when token is missing: This is consistent with other
  // "token + fallback" writing methods in this document, and does not write the literal value directly in the rules.
  // The text color uses static white token in the same way.
  '.dsh-pet-cfg__avatarMask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:14px;background:var(--dsw-alias-bg-mask,rgba(0,0,0,.55));color:var(--dsw-static-neutral-00,#fff);font-size:12px;line-height:1;opacity:0;transition:opacity .12s;pointer-events:none}',
  '.dsh-pet-cfg__avatarPick:hover .dsh-pet-cfg__avatarMask,.dsh-pet-cfg__avatarPick:focus-within .dsh-pet-cfg__avatarMask,.dsh-pet-cfg__avatarMask.is-busy{opacity:1}',
  '.dsh-pet-cfg__file{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:0}',

  // There are no "two rows on the right" to support vertical layout: the avatar returns to the 72 px square, otherwise it will be stretched into a full-width image.
  '@container (max-width:400px){.dsh-pet-cfg__topRow{grid-template-columns:minmax(0,1fr)}.dsh-pet-cfg__avatarCol{width:72px}.dsh-pet-cfg__avatarImg{height:72px;min-height:0}}',

  '.dsh-pet-cfg__inp{box-sizing:border-box;width:100%;min-height:28px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}',
  '.dsh-pet-cfg__inp:focus{border-color:var(--dsw-alias-state-business-primary)}',
  '.dsh-pet-cfg__inp:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',

  // persona reuses the border and font size of __inp, only height and vertical scaling are supplemented; persona has no upper limit on length, only character count is displayed in the lower right corner, and input is not blocked.
  '.dsh-pet-cfg__persona{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.dsh-pet-cfg__area{min-height:66px;resize:vertical;line-height:18px}',
  '.dsh-pet-cfg__count{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:right}',

  '.dsh-pet-cfg__toggle{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary)}',
  '.dsh-pet-cfg__toggle>label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;min-width:0}',
  '.dsh-pet-cfg__toggle>label>span{overflow-wrap:anywhere}',
  '.dsh-pet-cfg__toggle input[type=checkbox]{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}',

  // The floating description bubble is hung from ./tip-layer by pressing the cursor on body, and is not drawn in the
  // trigger element - the descriptions in the right column and top will be cut off by the edge of the window or the
  // scroll container. Only the appearance is concerned here, the coordinates are written from tooltipPlacement to
  // style.
  '.pet-cfg-tip{position:fixed;left:0;top:0;z-index:2147483000;max-width:320px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-00);font-size:12px;font-style:normal;font-weight:400;line-height:18px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;opacity:0;transition:opacity .12s ease;box-shadow:var(--dsw-elevation-prominent,0 6px 20px rgba(0,0,0,.22))}',
  '.pet-cfg-tip.is-on{opacity:1}',

  // Question mark: A circular host appearance of a bubble.
  '.dsh-pet-cfg__q{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;border:1px solid var(--dsw-alias-label-tertiary);border-radius:50%;color:var(--dsw-alias-label-tertiary);font-size:10px;font-style:normal;line-height:1;cursor:help;user-select:none}',
  // The folding card puts the question mark into the title button: wrap it with a layer of span to intercept clicks separately (clicking on the question mark only produces a bubble and does not open or close it).
  '.dsh-pet-cfg__qWrap{display:inline-flex;flex:none;align-items:center}',

  '.dsh-pet-cfg__btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 14px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}',
  // The solid main button must be excluded from the general hover: the translucent hover will push out the
  // button-info-fill, making the blue button turn white as soon as it is hovered; the hover of the main button will be
  // the theme's own button-info-hover.
  '.dsh-pet-cfg__btn:hover:not(:disabled):not(.is-primary){background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-pet-cfg__btn:disabled{opacity:.5;cursor:default}',
  '.dsh-pet-cfg__btn.is-primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:#fff}',
  '.dsh-pet-cfg__btn.is-primary:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}',
  '.dsh-pet-cfg__btn.is-danger{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}',
  '.dsh-pet-cfg__btn.is-sm{padding:2px 10px}',
  '.dsh-pet-cfg__btn.is-ghost{border-style:dashed;color:var(--dsw-alias-label-secondary)}',

  '.dsh-pet-cfg__tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
  '.dsh-pet-cfg__tabsLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}',
  // The category bar is on a separate line: separated from the pet bar below to prevent the two groups of buttons from reading into one line.
  '.dsh-pet-cfg__kinds{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}',
  '.dsh-pet-cfg__tab{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}',
  '.dsh-pet-cfg__tab:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh-pet-cfg__tab:disabled{opacity:.5;cursor:default}',
  '.dsh-pet-cfg__tab.is-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}',
  '.dsh-pet-cfg__tab.is-ghost{border-style:dashed;color:var(--dsw-alias-label-secondary)}',

  '.dsh-pet-cfg__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}',
  '.dsh-pet-cfg__msg{margin-left:4px;font-size:12px;color:var(--dsw-alias-state-success-primary)}',
  '.dsh-pet-cfg__msg.is-err{color:var(--dsw-alias-state-error-primary)}',
  '.dsh-pet-cfg__note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh-pet-cfg__path{font-size:12px;line-height:18px;word-break:break-all;user-select:text;color:var(--dsw-alias-label-secondary)}',
  '.dsh-pet-cfg__path b{color:var(--dsw-alias-label-primary);font-weight:400}',
  '.dsh-pet-cfg__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;font-size:12px;line-height:18px;word-break:break-all;user-select:text;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
].join('\n');

/** The mark value used for injecting deduplicate is written on `data-plugin-css` of `<style>`. */
const settingsCssTag = 'dsh-pet/settings.css';

/** Inject the setting page style into `document.head`: idempotent, and return directly when there is no document (SSR or single test). */
export function injectSettingsCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + settingsCssTag + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = settingsCssTag;
  tag.textContent = SETTINGS_CSS;
  document.head.appendChild(tag);
}
