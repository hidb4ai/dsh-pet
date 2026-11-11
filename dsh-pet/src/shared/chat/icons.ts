/**
 * Three inline SVG icons in the dialog pop-up window. Do not use emoji: the same symbol will be rendered into a
 * variant font under different font fallback chains (this is the case with 🖼 for uploading on Windows).
 * @module dsh-pet/src/shared/chat/icons
 */

/** Stroke properties shared by SVG icons: a line width and text color. */
const ICON_ATTRS = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.8',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
};

/** Create a SVG child element (the attributes are written as they are, and the namespace is fixed to SVG). */
function svgNode(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node as SVGElement;
}

/** Picture icon: outer frame + sun + ridge. */
export function pictureIcon(size = 16): SVGElement {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    ...ICON_ATTRS,
  });
  svg.append(
    svgNode('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }),
    svgNode('circle', { cx: '8.5', cy: '8.5', r: '1.5' }),
    svgNode('path', { d: 'M21 15l-5-5L5 21' }),
  );
  return svg;
}

/** Microphone icon: microphone capsule + pickup arc + bracket. */
export function micIcon(size = 16): SVGElement {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    ...ICON_ATTRS,
  });
  svg.append(
    svgNode('rect', { x: '9', y: '2', width: '6', height: '11', rx: '3' }),
    svgNode('path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0' }),
    svgNode('path', { d: 'M12 17.5V21' }),
    svgNode('path', { d: 'M8.5 21h7' }),
  );
  return svg;
}

/** Camera icon: body + lens. */
export function cameraIcon(size = 16): SVGElement {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    ...ICON_ATTRS,
  });
  svg.append(
    svgNode('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
    svgNode('circle', { cx: '12', cy: '13', r: '4' }),
  );
  return svg;
}
