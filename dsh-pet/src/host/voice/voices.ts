/**
 * The single truth about voice voice: whitelisting, presentation metadata and defaults.
 *
 * `voice` in the request body only accepts id listed here - it does not accept any voice string, otherwise it will
 * open up all the capabilities of the upstream, and if there is a problem, it will not be clear who sent it. The list
 * interface and verification both read the same constant and do not write a second copy.
 * @module dsh-pet/src/host/voice/voices
 */

/** An optional voice; `id` is the short name of the edge server, and the remaining fields are only for display. */
export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly default: boolean;
}

/** The four requested Chinese voices are allowed; the one marked `default` is the default. */
export const VOICES: readonly VoiceInfo[] = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', tag: '女 · 通用', default: false },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', tag: '女 · 活泼', default: true },
  { id: 'zh-CN-YunxiNeural', name: '云希', tag: '男 · 年轻', default: false },
  { id: 'zh-CN-YunjianNeural', name: '云健', tag: '男 · 沉稳', default: false },
];

/** Default tone id; used when neither request nor configuration is specified, it must be consistent with the one marked `default` in {@link VOICES}. */
export const DEFAULT_VOICE = 'zh-CN-XiaoyiNeural';

/**
 * Determine whether the tone is in the white list.
 * @param id - The tone to be verified id.
 * @returns is true when it belongs to the whitelist.
 */
export function isKnownVoice(id: string): boolean {
  return VOICES.some((voice) => voice.id === id);
}
