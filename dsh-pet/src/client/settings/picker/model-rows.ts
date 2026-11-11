/**
 * Pure view model of the model selector: fold the "candidate list + search terms" into a list that can be rendered
 * line by line, and give the line number that the keyboard can navigate. Does not touch DOM and does not hold state;
 * the search semantics (case-insensitive ordered subsequences) are consistent with the model selector that comes with
 * DSH. The row order is fixed as: following the current conversation (only when there is no search term) → the group
 * header of each service provider → the model hit in the group, or "no model available" in the group.
 * @module dsh-pet/src/client/settings/picker/model-rows
 */

/** A group in the candidate list: a service provider and the model under its name (response form of `GET /models`). */
export interface ModelCatalogGroup {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

/** A line in the selector overlay: following the current conversation, provider group header, model or "This provider has no available models". */
export type ModelRow =
  | { kind: 'follow'; key: string }
  | { kind: 'group'; key: string; name: string }
  | { kind: 'none'; key: string }
  | { kind: 'model'; key: string; provider: string; model: { id: string; name: string } };

/**
 * Whether the search term hits: Case-insensitive ordered subsequence matching, empty search term hits everything.
 * @param text - The text to be searched, usually "model name + space + model id".
 * @param query - User input; whitespace on both sides is ignored.
 * If @returns hits, true is returned; if characters are in wrong order or characters are incomplete, false is
 * returned.
 */
export function matchModelQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  let at = 0;
  for (const char of text.toLowerCase()) {
    if (char === needle[at]) at += 1;
    if (at >= needle.length) return true;
  }
  return false;
}

/**
 * Collapse candidate list into renderable rows.
 *
 * @param groups - candidate list; `[]` indicates that the host has no available service provider.
 * @param query - search term; if empty, an extra line of "Follow current conversation" will be added.
 * @returns line list; group header and "No model available" line are not selectable, see {@link selectableIndexes} .
 */
export function buildModelRows(groups: readonly ModelCatalogGroup[], query: string): ModelRow[] {
  const needle = query.trim().toLowerCase();
  const rows: ModelRow[] = [];
  // "Follow the current conversation" is not a model and only appears when there is no search term.
  if (needle === '') rows.push({ kind: 'follow', key: '__follow' });
  for (const group of groups) {
    const models = group.models.filter((model) => matchModelQuery(model.name + ' ' + model.id, needle));
    // When there is a search term, the entire group will not be displayed if there is no hit; when there is no search term, the group header should be left to hang "No available model" in the empty group.
    if (models.length === 0 && !(needle === '' && group.models.length === 0)) continue;
    rows.push({ kind: 'group', key: group.id, name: group.name });
    if (models.length === 0) {
      rows.push({ kind: 'none', key: group.id + '/__none' });
      continue;
    }
    for (const model of models) {
      rows.push({ kind: 'model', key: group.id + '/' + model.id, provider: group.id, model });
    }
  }
  return rows;
}

/**
 * Keyboard ↑↓ can only stop at optional items: group header and prompt line are skipped.
 *
 * @param rows - Output of {@link buildModelRows} .
 * @returns The subscript of the optional row, arranged in ascending order.
 */
export function selectableIndexes(rows: readonly ModelRow[]): number[] {
  return rows.map((row, index) => (row.kind === 'group' || row.kind === 'none' ? -1 : index)).filter((i) => i >= 0);
}
