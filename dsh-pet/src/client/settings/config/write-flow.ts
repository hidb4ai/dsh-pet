/**
 * The write path arrangement of the settings page: saving, requesting synchronization, and what exactly does "confirm"
 * in the confirmation pop-up window do. All three actions must first go through form verification (the same set of
 * rules), and then translate the results into red text or pop-up windows - the caller only accepts status. The
 * callback is passed in instead of the value: `save` . Each time the rendering is rebuilt, the old value will be saved
 * to the disk if the state is captured directly.
 * @module dsh-pet/src/client/settings/config/write-flow
 */
import type { SaveFields } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { Feedback } from '../actions.ts';
import type { DialogState } from '../dialog.ts';
import { persistSettings, syncSettings } from './persist.ts';
import type { PackWrite } from './pack-writes.ts';
import { validateForm } from './validate-form.ts';

/** Dependence of {@link createWriteFlow}. */
export interface WriteFlowDeps {
  /** Now get all the fields to be submitted. */
  fields: () => SaveFields;
  /** The currently calculated category layer has changed (compared to the loading snapshot, main is not among them). */
  packWrites: () => readonly PackWrite[];
  /** Whether it is currently being saved (re-entry protection). */
  busy: () => boolean;
  /** Set the saving flag; the entire form is disabled during disk writing. */
  setBusy: (busy: boolean) => void;
  /** Local display save/sync feedback. */
  setMsg: (feedback: Feedback) => void;
  /** Open or close the pop-up window. */
  setDialog: (dialog: DialogState) => void;
  /** Read the current pop-up window and only know which action to dispatch when confirming. */
  dialog: () => DialogState;
  /** Refresh the form after successful synchronization. */
  applyConfig: (merged: MergedConfig) => void;
  /** Fallback when the host does not return the actual write path (user configuration path in meta). */
  userFile: () => string;
  /** Copy translation. */
  t: (key: string) => string;
  /** Really delete the selected pet (it will be adjusted after both verification and confirmation). */
  onRemove: () => void;
}

/** The three entry points exposed by the write path. */
export interface WriteFlow {
  /** Save all configurations; `force` is strictly allowed to reconstruct damaged files only as `true`. */
  save: (force?: boolean) => Promise<void>;
  /** Request synchronization: confirm first (it will cover the user layer and cannot be done with just one click). */
  requestSync: () => void;
  /** Distribution after pop-up window confirmation. */
  confirmDialog: () => void;
}

/**
 * Create path.
 *
 * @param deps - status reading and writing callback.
 * @returns Save/Request synchronization/Confirm dispatch.
 */
export function createWriteFlow(deps: WriteFlowDeps): WriteFlow {
  const { setBusy, setMsg, setDialog, t } = deps;

  const save = async (force = false): Promise<void> => {
    if (deps.busy()) return;
    const fields = deps.fields();
    const invalid = validateForm({
      pets: fields.pets,
      physics: fields.physics,
      whisperModel: fields.whisperModel,
      chatModel: fields.chatModel,
      chatMemory: fields.chatMemoryRounds,
      chatImageLimit: fields.chatImageLimit,
      font: fields.font,
    });
    if (invalid !== null) {
      setMsg({ kind: 'err', text: t(invalid) });
      return;
    }
    setBusy(true);
    setMsg({ kind: '', text: '' });
    try {
      const result = await persistSettings(fields, deps.packWrites(), force, deps.userFile());
      if (result.kind === 'ok') {
        setMsg({ kind: 'ok', text: t('saved') });
        return;
      }
      if (result.kind === 'corrupt') {
        setDialog({ kind: 'corrupt', path: result.path });
        return;
      }
      // main has persisted to disk, some types were not written successfully: you must tell the truth, otherwise the user will think that the entire package has not been saved.
      if (result.kind === 'partial') {
        setMsg({ kind: 'err', text: t('savePartial').replace('{names}', result.failed.join('、')) });
        return;
      }
      setMsg({ kind: 'err', text: t(result.kind === 'invalid' ? 'saveInvalid' : 'saveError') });
    } finally {
      setBusy(false);
    }
  };

  const doSync = async (): Promise<void> => {
    setBusy(true);
    setMsg({ kind: '', text: '' });
    try {
      // Synchronize the user layer: POST writes the entire built-in default configuration (original text, including comments) to the user configuration, and the response body is also the resolved configuration.
      const merged = await syncSettings();
      if (merged === null) {
        setMsg({ kind: 'err', text: t('syncError') });
        return;
      }
      // The same resolved value both refreshes the form and is handed over to the container: both the editing list and the rendering list are derived from the resolved value.
      deps.applyConfig(merged);
      setMsg({ kind: 'ok', text: t('saved') });
    } finally {
      setBusy(false);
    }
  };

  return {
    save,
    requestSync: () => setDialog({ kind: 'sync' }),
    confirmDialog: () => {
      const pending = deps.dialog();
      if (pending === null) return;
      setDialog(null);
      if (pending.kind === 'remove') deps.onRemove();
      else if (pending.kind === 'corrupt') void save(true);
      else if (pending.kind === 'sync') void doSync();
    },
  };
}
