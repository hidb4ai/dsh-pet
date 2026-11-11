/**
 * Ownership of dragged files: Claim drop that falls on our interface to prevent the same picture from being processed
 * once by DSH and desktop pet.
 */
import { dragHasFiles, firstImageFile } from '../shared/chat/image-pick.ts';

/** The highlighted class name of the landing point; the specific style is written by each landing point. */
export const DROP_TARGET_CLASS = 'is-drop-target';

/** The structural subset of drag events: both the native DragEvent and the synthesis event injected into react are satisfied. */
export interface DragLike {
  /** Data carried by drag and drop; non-HTML drag source may be empty. */
  readonly dataTransfer: DataTransfer | null;
  /** Block the default behavior: otherwise the browser will open the dragged file as a navigation and the page will be replaced directly. */
  preventDefault: () => void;
  /** Block bubbling: DSH’s drag monitoring is on the ancestor of the same tree, and will be processed again by it if not blocked. */
  stopPropagation: () => void;
}

/** Additional information for drop point events. */
export interface DropTargetLike extends DragLike {
  /** The element that the listener is currently bound to; it may be empty in native events. */
  readonly currentTarget: EventTarget | null;
  /** The target the pointer enters when leaving; used to distinguish between "leaving the drop point" and "moving between drop point sub-elements". */
  readonly relatedTarget: EventTarget | null;
}

/**
 * Claim "the pointer has just entered the landing point": block bubbling and close the host's full page mask.
 *
 * The host's mask is driven by dragenter on document. After the pointer enters our area, it should no longer press the
 * entire page; its count was added long before the pointer entered our area, so it needs to be finished here.
 *
 * @param event - dragenter received by the drop point.
 * @returns with files is true and bubbling has been blocked; other dragging returns false without touching events and
 * masks.
 */
export function claimFileDragEnter(event: DragLike): boolean {
  if (!dragHasFiles(event)) return false;
  event.stopPropagation();
  hideHostDropOverlay();
  return true;
}

/**
 * Claim the drag of "File passed".
 *
 * @param event - dragover received by our interface.
 * @returns with files is true, and the default behavior and bubbling have been blocked; plain text and other drag and
 * drop return false without touching events.
 */
export function claimFileDragOver(event: DragLike): boolean {
  if (!dragHasFiles(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/**
 * Drag and drop files dropped on our interface.
 *
 * @param event - drop received by our interface.
 * @returns is the first sendable picture; when it is not a file, the event will not be touched. When it is a file but
 * the picture cannot be recognized, it will be swallowed and returned to undefined.
 */
export function claimFileDrop(event: DragLike): File | undefined {
  if (!dragHasFiles(event)) return undefined;
  event.preventDefault();
  event.stopPropagation();
  hideHostDropOverlay();
  return firstImageFile(event.dataTransfer);
}

/**
 * Collapse the full page drag mask of host (DSH).
 *
 * It maintains the mask with the dragenter/dragleave count on document, and only dragend on drop and window will be
 * cleared. After our drop intercepts the bubbling, it cannot receive the cleanup signal, and the mask will remain
 * hanging; if the file is not included this time, the upload will not be triggered.
 */
function hideHostDropOverlay(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('dragend'));
}

/**
 * Mark the drop point as placeable.
 *
 * @param event - dragenter on drop point.
 */
export function markDropTarget(event: DropTargetLike): void {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) return;
  if (!claimFileDragEnter(event)) return;
  el.classList.add(DROP_TARGET_CLASS);
}

/**
 * Remove the highlighting of drop points.
 *
 * dragleave will also be triggered when the pointer moves between the sub-elements of the landing point. At this time,
 * relatedTarget is still in the area and does not count as leaving; otherwise, the highlight will flash as the pointer
 * moves between the input box and the button.
 *
 * @param event - dragleave on drop point, or drop on drop point.
 */
export function unmarkDropTarget(event: DropTargetLike): void {
  const el = event.currentTarget;
  const to = event.relatedTarget;
  if (!(el instanceof HTMLElement)) return;
  if (to instanceof Node && el.contains(to)) return;
  el.classList.remove(DROP_TARGET_CLASS);
}
