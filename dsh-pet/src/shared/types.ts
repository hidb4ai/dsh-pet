/**
 * Type model isomorphic to config.jsonc: animations / animationWeights / pets has only one definition. Runtime
 * (browser side, desktop Helper, settings page) uses this structure directly without creating additional converted
 * types. Pure types and constants, no React / DOM dependencies.
 * @module dsh-pet/src/shared/types
 */

/** Supported corners. */
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Axis-aligned rectangle (upper left corner + width and height): The monitor working area, window content area, and visual gripping area share the same shape. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Display position: Determines the visibility of pets on the browser side and desktop. */
export type PetDisplay = 'web' | 'desktop' | 'both' | 'none';

/** Move action: action name + optional override parameters (unwritten fields are taken as moves.default). */
export interface MoveSpec {
  name: string;
  params?: Record<string, number>;
}

/** Mobile pool. */
export interface MovesConfig {
  default: Record<string, number>;
  actions: MoveSpec[];
}

/** Random action classification (with text and mirror image will be reversed, skipped when facing = right). */
export interface Category {
  id: string;
  weight: number;
  noMirror?: boolean;
  actions: string[];
}

/** Event state slot: single animation name (fixed playback) or candidate array (1 randomly selected within the trigger time frame). */
export type EventSlot = string | string[];

/** Event animation: event name → state slot array (the order of the array is the order of the states; it does not enter the random chain and is only explicitly triggered by the code). */
export type Events = Record<string, EventSlot[]>;

/**
 * A set of sleeping actions: fall asleep → cycle → wake up. Each of the three segments is a candidate array (one is
 * randomly selected when entering the segment); the entire set is randomly selected from the outer array of
 * animations.sleep. The three segments must come from the same set, otherwise "falling asleep while squatting and
 * waking up lying on the stomach" will occur.
 */
export interface SleepSet {
  start: string[];
  loop: string[];
  end: string[];
}

/** Animation weights. */
export interface Weights {
  idle: number;
  turn: number;
  move: number;
}

/** animations segment of config.jsonc. */
export interface Animations {
  idle: string[];
  turn: string[];
  drag: string[];
  clicks: string[];
  moves: MovesConfig;
  categories: Category[];
  events: Events;
  /**
   * Sleep action set (optional): Not written = This entry does not have a sleep function, and "Sleep" does not appear
   * in the right-click menu. Once written, select "Random from the entire set → Random within the segment". For the
   * structure, see {@link SleepSet} .
   */
  sleep?: SleepSet[];
  /**
   * The animation of the built-in gameplay "Eat Rice" (optional): the key name is the gameplay id, and the value is
   * **exactly 5** animation names, corresponding to the position: running to the bottom of the screen, running
   * sideways when chasing rice, waiting for the meal to be served after arriving, eating a bowl of rice, and eating a
   * ball. Not written = This entry does not have this gameplay; the number and order of slots are the gameplay
   * contract (the code is retrieved by index), and the name is just the asset file name.
   */
  baifan?: string[];
}

/**
 * A pet (the same shape as config.jsonc's pets [i], position is nested). Optional segments are derived during
 * rendering or dedicated to file pets: entry-level fields are blown into each instance by the merger during shooting,
 * and are shared by multiple instances; extra marks the file pet (the settings page cannot be edited, excluded when
 * saving, and never appears in the persistence configuration); assetRoot is the asset root (= configuration file
 * prefix), and multiple instances share the same asset directory, so use it instead of id for asset URL.
 */
export interface Pet {
  /** Unique identifier (used for program positioning: asset, memory, and endpoint parameters are all according to it; never overlap, conflict means configuration error) */
  id: string;
  /**
   * Display name (repeatable): Use it for floating prompts, AI persona, and command line positioning. If it is missing
   * or left blank, it will be processed as the pet id and an warning will be issued.
   */
  name: string;
  size: number;
  /**
   * The upper limit of the character's screen width (%, default 20, no upper limit): The frame width is calculated
   * based on the body's screen occupation. `size` is still the upper limit of the frame. 100 ≈ No limit (the display
   * is consistent with pressing px in a wide window); fill in 150 and the character will be wider than the screen, but
   * the frame will still be clamped by `size` . Less than 1 or non-numeric fallback to 20. Only works on the browser
   * side - desktop transparent windows always use `size` .
   */
  sizePercent?: number;
  /** Whether to enable the balance function: true = trigger the balance animation and display the balance bubble, false = completely disable the balance for this pet. Missing configuration error */
  balanceEnabled: boolean;
  /**
   * Whether to enable whisper: true = generate a sentence and play whisper animation according to
   * eventsRefreshSec.whisper cycle, false = disabled. The default true is missing; whisper will call the current
   * conversation model every time it is generated. When the local LLM is single concurrency, it will override the KV
   * cache of the running task. Please write false explicitly for pets that are not needed. display is completely
   * skipped as the pet of none: no generation, no model adjustment.
   */
  whisperEnabled: boolean;
  /**
   * Whether to enable working status linkage: true = Listen to the DSH session event, press
   * animations.events.workStatus to switch state animation and bubble. Missing default true. Monitoring does not call
   * the model, and there is no KV cache risk.
   */
  workStatusEnabled: boolean;
  /**
   * Pet fixed: true = Random chain does not switch to two states of steering and movement (the weight is calculated as
   * 0, and the share is merged into the small movement in place). It only affects the random chain - right-click
   * playback request, / anim interface, event animation, click response and drag and drop are all the same. Missing
   * default false.
   */
  fixedEnabled: boolean;
  /** Display position (required): If it is missing, it means the configuration is wrong, and the code does not perform fallback. */
  display: PetDisplay;
  position: { corner: Corner; marginX: number; marginY: number };
  /**
   * Instance-level persona (pets []. whisperPrompt): System prompt word text shared by whisper and dialogue. If it is
   * written, it will replace the top-level copy of the corresponding entry (replacement rather than concatenate). If
   * it is not written or the string is empty, the fallback entry will be used - fallback occurs on the host side and
   * is not an error. write-only text: The name and time background are appended unconditionally by the host. Do not
   * write them repeatedly here.
   */
  whisperPrompt?: string;
  animations?: Animations;
  animationWeights?: Weights;
  extra?: boolean;
  assetRoot?: string;
  /**
   * Global default: event refresh period (seconds, event name → interval; replace the entire segment, and the missing
   * keys will be fallbacked by each consumer). . whisper is read according to the entry it belongs to (the type can be
   * overridden), . balance is read-only main entry.
   */
  eventsRefreshSec?: Record<string, number>;
  /** Global default: drag and throw physical parameters (the user writes it once and it will take effect on all pets, including pet pack; if the type file is written at the top level, use your own copy) */
  physics?: PhysicsParams;
  /** Global default: whether to lock on the current screen - throwing and autonomous roaming are only active on the current screen */
  confineToScreen?: boolean;
  /** Entry level: The rejection line played when being manually disturbed while sleeping (non-empty character string array, randomly selected one line). */
  sleepRefuseTexts?: string[];
  /** Entry level: Lines played when falling asleep (randomly picked when "Start" is played). */
  sleepStartTexts?: string[];
  /** Entry level: The line played when waking up (randomly pick a line when playing "Get Up"). */
  sleepEndTexts?: string[];
  /**
   * Entry level: Working status bubble copy (outer index = state 0..5, inner level can randomly select multiple
   * sentences from each state). The entire field is missing = the working status text is not played, only the animation
   * is played.
   */
  workStatusTexts?: string[][];
  /** Global default: whisper separately specified service provider + model; provider and model are both empty = follow the model of the current conversation */
  whisperModel?: ModelSelection;
  /** Global default: the service provider + model specified separately in the dialogue, both are empty = follow the model of the current dialogue */
  chatModel?: ModelSelection;
  /** Global default: font (type/font size/whether to scale with pet size) */
  font?: FontConfig;
  /**
   * Entry level: emoticon list (name → description for model), merger blows into each instance, multi-instance
   * sharing. The order is the configuration writing order, which is the basis for chatImageLimit to intercept the
   * "first N pictures".
   */
  memes?: Record<string, string>;
  /** Entry level: Dialog map switch. true = When the dialogue is generated, the emoticon list is given to the model to select one according to the context; the default processing is off. */
  chatImageEnabled?: boolean;
  /**
   * Entry level: Dialogue action linkage switch. true = During the conversation, hand over the action list under
   * categories to the model, and the model will pick one to perform on the spot when it fits the context; the default
   * is to turn it off.
   */
  chatAnimationEnabled?: boolean;
  /** Entry level: The upper limit of the number of dialogue pictures (non-negative integer, 0 = no limit). Only capture the "list given to the model", not the whisper pictures. */
  chatImageLimit?: number;
}

/**
 * A "service provider + model" selection (whisperModel / chatModel segment of config.jsonc). provider and model are
 * either empty (= the model that follows the current conversation), or both are non-empty. Filling only half of them
 * is a configuration error.
 */
export interface ModelSelection {
  /** Service provider route id (same namespace as DSH model selector) */
  provider: string;
  /** Model id under this service provider */
  model: string;
}

/**
 * physics segment of config.jsonc: Drag and throw feel parameters (global, shared by all pets). The default value is
 * {@link DEFAULT_PHYSICS} , and the built-in configuration is consistent with both sides of the code.
 */
export interface PhysicsParams {
  /** Gravity acceleration (px/s²): The bigger it is, the faster it falls; 0 = no gravity (valid, even and straight flight) */
  gravity: number;
  /** Recovery coefficient of rebound when hitting a wall 0~1 (1 = completely elastic, 0 = stops immediately upon impact; wall and ground are shared) */
  restitution: number;
  /** Tangential friction on the contact surface (/s): The velocity attenuation rate along the direction of the contact surface after hitting a wall, landing, or hitting the top, 0 = all sides are like ice */
  groundFriction: number;
  /** Whether the top rebounds: false = The top has no border, and it can fly out of the top of the screen when thrown (gravity will still pull the fallback) */
  ceilingBounce: boolean;
  /** Total strength (output gain of dragging and throwing): spring K/C, throwing initial velocity and soft upper limit overall × p (1.0 = status quo, must > 0) */
  throwPower: number;
  /** Multiple pets collide with each other switch: true (default) = Flying pets will bounce away according to momentum conservation when they collide with other pets; false = pass through each other */
  petCollision: boolean;
  /**
   * Tilt control gravity: true (default) = The phone tilt direction replaces the fixed downward gravity direction (the
   * size is still determined by gravity, and the full value is taken when it is vertical; when gravity is 0, there is
   * no available amount for tilt, which is equivalent to turning off); false = Gravity is always vertical downward.
   * Only the browser side takes effect, and the sensor is only available in the security context (HTTPS / localhost);
   * if the key is missing, press true.
   */
  tiltGravity?: boolean;
  /**
   * Shake and throw: true (default) = shake and throw the pet in the direction of the swing (strength = baseline ×
   * throwPower), regardless of the gravity, so it can also be used when gravity is 0; false = does not read the
   * accelerometer. Also only available in security context. If the key is missing, press true.
   */
  shakeThrow?: boolean;
  /**
   * Collision tactile feedback: true (default) when hitting the wall / landing / hitting the roof and pet colliding
   * with each other. Only the browser side takes effect, and the environment requires Vibration API - iOS and the
   * desktop side do not, so it is skipped silently. By default, press true; if there is no such key in the old
   * configuration, it is still enabled.
   */
  hapticEnabled?: boolean;
}

/** Font type default id (font.family white list; see shared/fonts.ts for the list and corresponding font stack). */
export type FontFamilyId = 'candy' | 'yahei' | 'youyuan' | 'kaiti' | 'simsun' | 'comic' | 'system';

/**
 * font segment of config.jsonc: font (a global copy, shared by all pets). Default = shared/fonts.ts of DEFAULT_FONT
 * (candy/21/true). Whole section replacement (same as physics): Once written, use the entire section with your own,
 * and the missing subkeys will not be filled in from the built-in default - when changing manually, all three subkeys
 * must be written, otherwise the entire section is invalid → an warning will occur and the default will be used.
 */
export interface FontConfig {
  /** Font type (default id): affects bubbles, floating prompts, dialog windows and score pop-ups */
  family: FontFamilyId;
  /** Font size px: Only affects the bubble and floating prompts (the font size of the dialog window and score pop-up window remains unchanged), the prompts and the small fonts in the bubble are derived according to the existing proportions */
  size: number;
  /** Whether the font size scales proportionally with the size of the pet: true = scale according to "actual size / base size" (default); false = always size px */
  followPet: boolean;
}

/** config.jsonc complete set - used directly at runtime. */
export interface ClientConfig {
  /** System notification master switch: true = Dialog completed / Generation failed / Output truncation / Permission application / Pop-up notification when user selects; missing means configuration error */
  notificationsEnabled: boolean;
  /**
   * Click the sound effect switch: true = play the built-in click-duck.wav when clicking the pet (volume 0.5,
   * deduplicate within 100 ms), false = mute. Built-in default false (default silent, no raid on existing users). This
   * copy of the read-only main entry, pet pack is not covered individually.
   */
  clickSoundEnabled: boolean;
  /**
   * Desktop mode system system tray switch: true = After the desktop is started, create a system tray in the
   * notification area (macOS is the menu bar), list all pets in the configuration (including display for web/none),
   * check to switch back to the desktop; false = Do not build. Missing default true. After turning it off, "call pets
   * that are not on the desktop back to the desktop" has no entry point on the desktop side, and can only go to the
   * settings page or the web page right-click menu.
   */
  trayEnabled: boolean;
  /** Whisper picture switch: true = Randomly draw 1 picture from the emoticon pool each time and display the text (whisper has no context, so it is random) */
  whisperImageEnabled: boolean;
  /** Dialogue picture switch: true = Submit the list of emoticons to the model and select one according to the context (optional), false = Plain text */
  chatImageEnabled: boolean;
  /** Dialogue action linkage switch: true = Submit the action list under categories to the model and select one according to the context to perform on the spot, false = Pure text */
  chatAnimationEnabled: boolean;
  /**
   * Whether to lock the pet on the current screen: true = The pet can only move within the current screen - if it is
   * thrown out, it will only bounce within the screen (the screen seam acts as a wall), and autonomous roaming will
   * only move within the screen; false = Cross-screen flying and cross-screen walking. The root field does not belong
   * to physics - it does not change the feel, only changes "where it is allowed to go". Entry level, required, missing
   * means configuration error.
   */
  confineToScreen: boolean;
  pets: Pet[];
  animations: Animations;
  animationWeights: Weights;
  /** Drag and throw physical parameters (global, shared by all pets; the combiner has been filled in by default) */
  physics: PhysicsParams;
  /** Service provider + model used by whisper (entry level; both are empty = follow the model of the current conversation) */
  whisperModel: ModelSelection;
  /** Provider + model for conversation (entry level; both empty = follow model for current conversation) */
  chatModel: ModelSelection;
  /** Event refresh period (seconds): event name → interval; balance = balance data refresh and animation trigger interval */
  eventsRefreshSec: Record<string, number>;
}
