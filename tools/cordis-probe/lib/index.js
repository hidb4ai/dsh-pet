/**
 * Host side of dsh-cordis-probe: Register five mock service providers and verify the third-party registration entry
 * point and display layer.
 *
 * Three things are indispensable:
 * - `ctx.llm.registerConfigurableProviders(...)` - Let them enter the "Model" directory on the settings page;
 * - `ctx.llm.registerAdapter(...)` —— Register the route so that the model can be selected and listed in the selector;
 * - `petApi7340.balance.register(...)` ——After selecting, you can check the balance and pop up the corresponding
 * bubble.
 *
 * There are two service providers that are **Customized multi-page bubbles** (`shape: 'custom'`): one reproduces the
 * built-in three forms into 4 pages, and the other self-designs 3 pages to verify the ability of "the third party
 * decides what the bubble looks like + clicks to cycle through pages".
 *
 * There are also two switches (speech synthesis/speech recognition): the default is disable. After turning it on, each
 * registers a mock implementation to verify the two third-party entry points `petApi7340.voice.register` and
 * `petApi7340.speech.register` . Memory is the same: a switch, turn it on to register mock memory and verify
 * `petApi7340.memory.register` .
 *
 * @module dsh-cordis-probe
 */
import { MOCK_BALANCE_PROVIDERS } from './mock-balance.js';
import { createMockAdapter } from './mock-adapter.js';
import { createMockMemoryProvider } from './mock-memory.js';
import { createMockSpeechProvider } from './mock-speech.js';
import { createMockVoiceProvider } from './mock-voice.js';
import { MEMORY_ROUTE, SPEECH_ROUTE, VOICE_ROUTE, createToggleHandler } from './toggle-route.js';

/** Cordis plugin name (displayed in diagnostics and logs). */
export const name = 'cordis-probe';

/**
 * Dependency statement: Cordis will wait for these services to be ready before executing `apply` . When `inject` is
 * missing, `apply` will run before the service is provided, and `ctx.get` cannot be obtained (actually tested).
 */
export const inject = ['llm', 'petApi7340'];

/** The name displayed in the model selector and settings page. */
const DISPLAY_NAMES = {
  'mock-windows': 'Mock 三窗口额度',
  'mock-money': 'Mock 账户余额',
  'mock-points': 'Mock 积分',
  'mock-custom-kinds': 'Mock 自定义（4 页复刻三种形态）',
  'mock-custom-fancy': 'Mock 自定义（3 页复杂布局）',
};

/** The namespace to which these mock service providers belong in the settings page (no configuration items, only used for rendering cards). */
const SETTINGS_NS = 'llm-cordis-probe';

/**
 * Register mock service provider.
 *
 * @param ctx - host Cordis context; service guaranteed to be present by inject, only balance registration is skipped
 * when `petApi7340` is missing.
 */
export function apply(ctx) {
  const ids = MOCK_BALANCE_PROVIDERS.map((p) => p.id);

  // 1) Model directory on the settings page
  try {
    ctx.effect(() =>
      ctx.llm.registerConfigurableProviders(
        MOCK_BALANCE_PROVIDERS.map((p) => ({
          provider: p.id,
          displayName: DISPLAY_NAMES[p.id] ?? p.id,
          settingsNs: SETTINGS_NS,
          settingsPath: [],
        })),
      ),
    );
  } catch (e) {
    warn('模型目录', e);
  }

  // 2) Model routing: allow these id to be selected in the selector and advertise a model
  try {
    ctx.effect(() => ctx.llm.registerAdapter(ids, createMockAdapter(DISPLAY_NAMES)));
  } catch (e) {
    warn('模型路由', e);
  }

  // 3) Balance registration form: you can check the balance after selecting it
  const balance = ctx.get('petApi7340', false)?.balance;
  if (!balance) return;
  for (const def of MOCK_BALANCE_PROVIDERS) {
    try {
      ctx.effect(() => balance.register(def));
    } catch (e) {
      warn('余额服务商 ' + def.id, e);
    }
  }

  // 4) Speech and recognition: each has a switch, the default is disable, and when turned on, register and mock are
  // implemented. The registration is on the host and the button is on the page. There is no direct channel between the
  // two halves, so two additional minimum routes are opened for the page points.
  const api = ctx.get('petApi7340', false);
  /** Route of the switch to be mounted: Path → Read and Write Control. */
  const toggles = [];

  const voice = api?.voice;
  if (voice) {
    /** Logout function turned on; null = currently disable. */
    let disposeVoice = null;
    /** Enable/disable mock voice; idempotent, repeated calls will not superimpose registration. */
    const setVoiceOn = (on) => {
      if (on && !disposeVoice) disposeVoice = voice.register(createMockVoiceProvider());
      if (!on && disposeVoice) {
        disposeVoice();
        disposeVoice = null;
      }
      return on;
    };
    // Make sure to log out when uninstalling the plugin: otherwise the mock voice will remain in the host, and the / voice/speak voice will continue to sound after that.
    ctx.effect(() => () => {
      setVoiceOn(false);
    });
    toggles.push([VOICE_ROUTE, { isOn: () => disposeVoice !== null, setOn: setVoiceOn }]);
  }

  const speech = api?.speech;
  if (speech) {
    /** Logout function turned on; null = currently disable. */
    let disposeSpeech = null;
    /** Enable/disable mock recognition; idempotent, repeated calls will not superimpose registration. */
    const setSpeechOn = (on) => {
      if (on && !disposeSpeech) disposeSpeech = speech.register(createMockSpeechProvider());
      if (!on && disposeSpeech) {
        disposeSpeech();
        disposeSpeech = null;
      }
      return on;
    };
    // Same as above: You must log out when uninstalling, otherwise / voice/hear will always return the text mock
    ctx.effect(() => () => {
      setSpeechOn(false);
    });
    toggles.push([SPEECH_ROUTE, { isOn: () => disposeSpeech !== null, setOn: setSpeechOn }]);
  }

  const memory = api?.memory;
  if (memory) {
    /** Logout function turned on; null = currently disable. */
    let disposeMemory = null;
    /** The currently held provider instance; after disable, it is left empty and the count restarts from 0. */
    let memoryProvider = null;
    /** Enable/disable mock memory; idempotent, repeated calls will not superimpose registration. */
    const setMemoryOn = (on) => {
      if (on && !disposeMemory) {
        memoryProvider = createMockMemoryProvider();
        disposeMemory = memory.register(memoryProvider);
      }
      if (!on && disposeMemory) {
        disposeMemory();
        disposeMemory = null;
        memoryProvider = null;
      }
      return on;
    };
    // Log out when uninstalling: otherwise the mock memory will remain in the host, and subsequent conversations will always contain mock evidence.
    ctx.effect(() => () => {
      setMemoryOn(false);
    });
    toggles.push([
      MEMORY_ROUTE,
      {
        isOn: () => disposeMemory !== null,
        setOn: setMemoryOn,
        // capture count: +1 after chatting, proving that the extension really received this round
        extra: () => ({ captured: memoryProvider ? memoryProvider.stats().captured : 0 }),
      },
    ]);
  }

  const webServer = ctx.get('webServer', false);
  if (!webServer) return;
  for (const [path, control] of toggles) {
    try {
      ctx.effect(() => webServer.register({ kind: 'prefix', path, handler: createToggleHandler(control) }));
    } catch (e) {
      warn('开关路由 ' + path, e);
    }
  }
}

/** Registration failure should not prevent the entire probe from starting up: just record a line in the log. */
function warn(what, e) {
  console.warn("[cordis-probe] Registration failed " + what + '：' + (e instanceof Error ? e.message : String(e)));
}
