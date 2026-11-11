/**
 * react capability contract for dialog panel (host injection, not import react directly).
 *
 * `h` is `jsx` of `react/jsx-runtime` : child nodes can only be put into `props.children` , and its third parameter is
 * key instead of children - passing it as a variable parameter will silently discard the content (shown as a whole
 * block of blank space).
 * @module dsh-pet/src/client/chat/runtime
 */
import type { Button, ImageLightbox, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Key } from './locales/index.ts';

/** Translation function of panel copy: `params` is used for `{name}` placeholder replacement. */
export type ChatTranslate = (key: Key, params?: Record<string, unknown>) => string;

/** UI primitive of DSH: Both the confirmation pop-up window and the image light box use platform components and do not need to be made by yourself. */
export interface PetChatUi {
  readonly Modal: typeof Modal;
  readonly Button: typeof Button;
  /** Original image lightbox: Use it when clicking on the image in the message (exactly the same component as the image viewing in the DSH session). */
  readonly ImageLightbox: typeof ImageLightbox;
}

/** Component with hook requires subset react. */
export interface ChatPanelRuntime {
  /** Create element; child node is written to `props.children`. */
  h: (type: unknown, props?: Record<string, unknown> | null) => unknown;
  /** Status. */
  useState: <T>(init: T) => [T, (next: T | ((prev: T) => T)) => void];
  /** side effect. */
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void;
  /** Cross-render reference. */
  useRef: <T>(initial: T) => { current: T };
  /** Text translation; what is read is the current language of the host, and it takes effect immediately when the language is switched. */
  readonly t: ChatTranslate;
  /** Platform UI primitive; when missing, the confirmation pop-up window degenerates into an inline confirmation bar. */
  readonly ui?: PetChatUi;
}
