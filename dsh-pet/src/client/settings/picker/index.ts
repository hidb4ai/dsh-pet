/**
 * Exports of model selector: row model, overlay positioning, overlay panel and selector component itself. External
 * files are only accessed here, and files in the group are not referenced by deep paths - there is no need to touch
 * caller when search semantics or positioning rules are changed.
 * @module dsh-pet/src/client/settings/picker
 */
export {
  buildModelRows,
  matchModelQuery,
  type ModelCatalogGroup,
  type ModelRow,
  selectableIndexes,
} from './model-rows.ts';
export { type AnchorRect, computePanelPlacement, type PanelPosition, type Viewport } from '../panel/placement.ts';
export { buildModelPanel, type ModelPanelView } from './model-picker-panel.ts';
export { makeModelPicker, type ModelPickerProps } from './model-picker.ts';
