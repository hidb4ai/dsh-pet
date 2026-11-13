/** Physical controls use the host theme and remain scrollable in narrow chat panes. */
export const ROBOT_CSS = `
.pet-robot { flex: none; font-size: 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.pet-robot summary { cursor: pointer; }
.pet-robot-body { max-height: 55vh; overflow: auto; padding-top: 8px; }
.pet-robot p { margin: 6px 0; overflow-wrap: anywhere; }
.pet-robot label { display: block; margin: 8px 0; }
.pet-robot input:not([type=checkbox]), .pet-robot select { box-sizing: border-box; width: 100%; padding: 6px; color: inherit; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; }
.pet-robot button { cursor: pointer; margin: 4px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 4px; background: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; }
.pet-robot button:disabled { opacity: .5; cursor: default; }
.pet-robot .pet-robot-stop { font-weight: bold; border: 2px solid currentColor; }
.pet-robot-note { color: var(--dsw-alias-label-secondary); }
.pet-robot fieldset { border: 0; padding: 0; min-width: 0; }
.pet-robot-action-row { border-top: 1px solid var(--dsw-alias-border-l2); padding: 8px 0; }
`;
