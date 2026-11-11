/**
 * Mock recognition implementation: without looking at the audio content, a fixed text with a number of bytes will be
 * returned.
 *
 * The purpose of existence is to verify that the third-party registration entry point of `petApi7340.speech.register`
 * is not connected to the Internet and does not load the model. After the switch is turned on, `POST /voice/hear` will
 * be redirected here. The number of bytes returned matches the sent one, which means that the audio really passes
 * through base64 and HTTP and reaches the host. Not registered by default: the switch is controlled by the
 * `/cordis-probe-speech` route of this warehouse (see ./toggle-route.js ).
 * @module dsh-cordis-probe/mock-speech
 */

/**
 * Make a provider: Regardless of text and speaking speed, the same paragraph will always be returned to
 * pseudo-transcription.
 * @returns can be passed directly to the definition of `speech.register` .
 */
export function createMockSpeechProvider() {
  return {
    id: 'mock-asr',
    name: 'Mock 识别',
    async transcribe({ audio, language }) {
      const suffix = language === undefined ? '' : '，语言 ' + language;
      return 'mock 识别：收到 ' + audio.byteLength + ' 字节' + suffix;
    },
  };
}
