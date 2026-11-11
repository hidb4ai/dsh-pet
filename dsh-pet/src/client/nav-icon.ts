/**
 * Settings panel navigation icon patch: Replace the fallback state in the "desktop pet configuration" row with the
 * specified icon. The navigation icon of DSH is hard-coded in the whitelist according to the partition id, and it is
 * private and cannot be referenced externally. It can only be done at the DOM layer. Only mark `data-*` and use
 * `::before` + mask to draw glyphs, leaving the DOM structure unchanged, otherwise React will crash on the replaced
 * node removeChild. mask is data URI, that is, an independent image document: starting from host 0.2.2, the icon is
 * changed to sprite reference (`<use>` points to `<symbol>` in the page), which must first be expanded into a
 * self-contained SVG, otherwise mask Fully transparent, the state is covered again, and the row directly becomes the
 * zero icon. sprite is injected by the host after mounting, and cannot be obtained at the moment of assembly, so the
 * glyph is delayed until the panel is recognized. The only way to identify rows is by relying on the title text: only
 * label is projected to DOM, and account row conditions appear and the position drifts, so `:nth-child` cannot be
 * used. Downgrade: Missing document / MutationObserver, not installing when the glyph cannot be obtained (the state is
 * retained), nothing is done when the line is not recognized, only an warning is issued.
 * @module dsh-pet/src/client/nav-icon
 */

/** Injected stylesheet deduplicate tag (same set of `data-plugin-css` conventions as pet page/settings page). */
const STYLE_TAG = 'dsh-pet/nav-icon.css';

/** The mark attribute hit on the target line `<button>`: React never diff It will not be lost regardless of re-rendering/all languages. */
const MARK = 'data-dsh-pet-nav';

/** Set the panel root node: shell is connected to body using `createPortal`. */
const PANEL_SELECTOR = '[data-shortcut-modal="settings"]';

/**
 * The class name comes from CSS Modules, the hash prefix will change with the DSH build, and only matches the name
 * parts `navList` / `navCell` / `navLabel` .
 */
const LIST_SELECTOR = '[class*="navList"]';
const CELL_SELECTOR = '[class*="navCell"]';
const LABEL_SELECTOR = '[class*="navLabel"]';

/** The goal of changing the icon: the title of a row of navigation and the glyph to be drawn on the row. */
export interface SectionNavIcon {
  /** The target row title has the same origin as label when registering `settings.section`; it is fetched each time. */
  label: () => string;
  /** Render the icon into inline SVG source code; injected by caller, this module therefore does not depend on react / react-dom. */
  renderSvg: () => string;
}

/**
 * Convert the inline SVG source code into data URI that can be used as CSS mask. It is necessary to add `xmlns` (data
 * URI is parsed according to independent image files, and will not be rendered if missing) and set `currentColor` to
 * opaque black (mask only looks at alpha).
 * @param svg - Inline SVG source code.
 * @returns `url("data:image/svg+xml,...")` ; Returns an empty string when the source code is empty.
 */
export function svgMaskUri(svg: string): string {
  const source = svg.trim();
  if (source === '') return '';
  const namespaced = /<svg[^>]*\sxmlns=/i.test(source)
    ? source
    : source.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return 'url("data:image/svg+xml,' + encodeURIComponent(namespaced.split('currentColor').join('#000')) + '")';
}

/** The definition of `<symbol>` in the host document: the attributes and content to be moved when expanding `<use>`. */
export interface SpriteSymbol {
  /** Move the attributes (viewBox, fill, stroke, etc.) one by one, and bring whatever is added to the host. */
  readonly attrs: Readonly<Record<string, string>>;
  /** Sub-content of `<symbol>`. */
  readonly content: string;
}

/** Press id to get `<symbol>`; if it cannot be obtained, it returns undefined, and the caller retains the fallback state accordingly. */
export type SymbolLookup = (id: string) => SpriteSymbol | undefined;

/**
 * Expand `<use href="#id">` in SVG into a self-contained graphic.
 *
 * data URI is an independent image document, `<use>` cannot find the host document `<symbol>` in it; if it is not
 * expanded, there will be only a blank space. Expand only the first reference: the icon glyph will not reference
 * multiple symbol .
 *
 * @param svg - Rendered inline SVG source code; unquoted (old version inline `<path>` ) is returned as is.
 * @param lookup - Find function to get `<symbol>` by id.
 * @returns self-contained SVG source code; when the referenced symbol cannot be obtained, undefined is returned.
 */
export function expandUseRefs(svg: string, lookup: SymbolLookup): string | undefined {
  const ref = /<use\b[^>]*\s(?:xlink:)?href="#([^"]+)"/i.exec(svg);
  if (ref === null) return svg;
  const symbol = lookup(ref[1]);
  if (symbol === undefined) return undefined;
  const attrs = Object.entries(symbol.attrs)
    .map(([name, value]) => ' ' + name + '="' + value + '"')
    .join('');
  return '<svg xmlns="http://www.w3.org/2000/svg"' + attrs + '>' + symbol.content + '</svg>';
}

/**
 * Create a finder that "press id to get `<symbol>` ": skip id when transferring attributes, and bring the content as
 * it is.
 * @param find - Function to find the element by id, usually `document.getElementById` .
 * The search function required by @returns `expandUseRefs` ; if not found, undefined is returned.
 * @internal
 */
export function symbolIn(find: (id: string) => Element | null): SymbolLookup {
  return (id) => {
    const symbol = find(id);
    if (symbol === null) return undefined;
    const attrs: Record<string, string> = {};
    for (let index = 0; index < symbol.attributes.length; index += 1) {
      const attr = symbol.attributes.item(index);
      if (attr === null || attr.name === 'id') continue;
      attrs[attr.name] = attr.value;
    }
    return { attrs, content: symbol.innerHTML };
  };
}

/** Use CSS to change the glyph: cover the state and draw our icon with `::before` + mask. */
function cssFor(glyph: string): string {
  return [
    '/* 「桌宠配置」行的导航图标：盖住齿轮，换成本模块的图形 */',
    '[' + MARK + '] [class*="navIcon"]{display:none}',
    '[' +
      MARK +
      ']::before{content:"";flex:none;width:16px;height:16px;background-color:currentColor;' +
      '-webkit-mask:' +
      glyph +
      ' center/16px 16px no-repeat;mask:' +
      glyph +
      ' center/16px 16px no-repeat}',
  ].join('\n');
}

/** Inject stylesheet (only once). */
function injectCss(doc: Document, glyph: string): void {
  if (doc.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]') !== null) return;
  const tag = doc.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = STYLE_TAG;
  tag.textContent = cssFor(glyph);
  doc.head.appendChild(tag);
}

/** Abnormal → Single line copy (for warning). */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Change the fallback state of the target partition in the settings panel navigation to the specified icon.
 * @param target - Target row title and glyph renderer.
 * @returns Disconnects the observer's cleanup function; injected styles and markup remain in place, without affecting
 * correctness.
 */
export function installSectionNavIcon(target: SectionNavIcon): () => void {
  const doc = typeof document === 'undefined' ? undefined : document;
  const Observer = typeof MutationObserver === 'undefined' ? undefined : MutationObserver;
  if (doc === undefined || Observer === undefined || doc.body === null) {
    console.warn('[dsh-pet] Settings icon unavailable: document, body or MutationObserver missing; retaining the gear');
    return () => {};
  }

  // sprite is injected by the host after mounting and cannot be obtained at the moment of assembly (see the module header), so it is postponed to be parsed until the panel is recognized.
  let injected = false;
  let warnedGlyph = false;

  /** The warning is only reported once: repeated switching of the panel will lead to the same failed path repeatedly. */
  const warnGlyph = (reason: string): void => {
    if (warnedGlyph) return;
    warnedGlyph = true;
    console.warn('[dsh-pet] Settings navigation icon unavailable:' + reason + '(retaining the default gear)');
  };

  /** Parse and inject the changing glyph style; it will not be recalculated after one success, and if it fails, wait until the panel appears next time and try again. */
  const ensureCss = (): void => {
    if (injected) return;
    let glyph: string;
    try {
      const expanded = expandUseRefs(
        target.renderSvg(),
        symbolIn((id) => doc.getElementById(id)),
      );
      if (expanded === undefined) {
        warnGlyph('sprite 里找不到引用的 <symbol>');
        return;
      }
      glyph = svgMaskUri(expanded);
    } catch (error) {
      warnGlyph('图标渲染失败：' + describe(error));
      return;
    }
    if (glyph === '') {
      warnGlyph('图标渲成了空 SVG');
      return;
    }
    injectCss(doc, glyph);
    injected = true;
  };

  // Can't recognize which line is expected (for example, DSH changed the title source), just remember it once and don't refresh the screen.
  let warned = false;

  /** Mark the row in the panel whose title matches (idempotent; the title will no longer be read if it has been marked). */
  const markPanel = (panel: Element): void => {
    try {
      const wanted = target.label();
      if (wanted === '') return;
      const list = panel.querySelector(LIST_SELECTOR);
      if (list === null) return;
      for (const cell of list.querySelectorAll(CELL_SELECTOR)) {
        if (cell.getAttribute(MARK) !== null) continue;
        if (cell.querySelector(LABEL_SELECTOR)?.textContent === wanted) cell.setAttribute(MARK, '');
      }
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn('[dsh-pet] Settings icon patch failed; retaining the default gear:' + describe(error));
      }
    }
  };

  // Two-stage observation: body only stares at the direct child node, and after hitting the panel, it changes to the panel subtree - the chat area DOM jitters frequently, and scanning the entire document is too expensive.
  let watched: Element | undefined;
  let panelObserver: MutationObserver | undefined;

  const sync = (): void => {
    const panel = doc.querySelector(PANEL_SELECTOR);
    if (panel === null) {
      panelObserver?.disconnect();
      panelObserver = undefined;
      watched = undefined;
      return;
    }
    markPanel(panel);
    if (panel === watched) return;
    // Try to parse glyphs when the panel first appears (or is reopened): sprite is usually mounted by this time.
    ensureCss();
    panelObserver?.disconnect();
    watched = panel;
    panelObserver = new Observer(() => {
      markPanel(panel);
    });
    panelObserver.observe(panel, { childList: true, subtree: true });
  };

  // The plugin may be assembled when the panel is open (refresh/hot update), so scan it synchronously first.
  sync();
  const bodyObserver = new Observer(sync);
  bodyObserver.observe(doc.body, { childList: true });

  return () => {
    bodyObserver.disconnect();
    panelObserver?.disconnect();
  };
}
