/**
 * Mock Voice implementation: Return a built-in prompt tone as "synthesis result".
 *
 * The purpose of existence is to verify the third-party registration entry point of `petApi7340.voice.register` - it
 * is not connected to the Internet and does not rely on the system voice engine. After the switch is turned on,
 * `POST /voice/speak` will go here instead. When you click it, you will hear a "beep", indicating that the link is
 * connected. Not registered by default: the switch is controlled by the `/cordis-probe-voice` route of this warehouse
 * (see ./toggle-route.js ).
 * @module dsh-cordis-probe/mock-voice
 */

/** 660 Hz, 0.3 second mono mp3 (embedded after ffmpeg is generated): carried with the package, does not read external files, and is not connected to the Internet. */
const TEST_TONE_BASE64 =
  'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAxAAAAAAAAAAAAAAD/81jAAAAAAAAAAAAASW5mbwAAAA8AAAALAAAFWAA1NTU1NTU1NTVKSkpKSkpKSkpeXl5eXl5eXl5ycnJycnJycnKGhoaGhoaGhoaampqampqampqvr6+vr6+vr6/Dw8PDw8PDw8PX19fX19fX19fr6+vr6+vr6+v///////////8AAAAATGF2YzYzLjEuAAAAAAAAAAAAAAAAJAPAAAAAAAAABVgx9R7nAAAAAAAAAAAAAAD/8zjEABTYrnANWGAAe2DluW5bluW5bvv/D7+Ow5DOGcNcdx/HIXeu+B1VAAg3UO1jowHICM7BMCYHxHJ5+/SixYsWOBiD4Pn8o6c5d+XDHAb9IY4DfznT/gM/3fyYIO0qgEAYAAt1AwGAwHD/8zjECxgZ+s5fjYADAAABPhGvCLCS+JaEV8yDrCwxQwmE2ECBdIAqCwoWaSpJYrJliURCpDhzhlv/HJFyitSHDnDnf/kyRUipkRYixj//l0umReLyKKKv//y8XkS6XVBUUlX//+f3///182D/8zjECReIkhgB3+AAAANLQmANABpgDwB6YA0AjmBqAhZgNADAEAehmubtyZXoNPmG1BIJg4QKebXhBuFqG7VYZFHVeXu7erHX+v/m69fZlUq0K78/fVX6+zev33bW7Ku2xqpkwAKyS3j/7/n/8zjECRTYiiIS3/bA//rv/E1oIJ1iF/zGiI0tXOcxjBfwn8ycxQFMqhCnTBkgOAwLMCPNZYzTlY1GpMlI0rIfpAcOe9HPP2zP3pf2+r+1VK/f//us//0V6wAKZFY/vO9/v//8/5SwItSYOEH/8zjEFBWoiiWU3/TAjI4ZIZmerRu1+YJKE1GPeJ3BkMITsYIwBQmAggCRgDZs2hyP5pC6a0O2jvzasex3trXm/tT1r//Vv36bv22/9/cowva38hgZfBuANjAoBgMMjUDJh2A1LATBkgyoyjv/8zjEHBMojhwAr/bAZSjLGg04wasEbMDGAqjanA2dfNqsDNCYv2/EvsA+7p//2dH31tc36v9P7/6W/f6fXf3/kODZQBQUBhAJgYqFoGPSEBmI3ga1chg1gW2ZYOuYmX4Bc5g0IFwYDsABiE//8zjELhKwjhwAr/bADPFk1u+MvLEBrvS3L/6fZ/+/2fqs32/72/oq/6X3t/IeHwA3PDMhAEQMID4DIKDA0dGDBZw3EySJtlMnrDkzBgASwwLsCtNtaTblI3ebM9HxYAfuWU+Bz/t/p1b/9av/8zjEQhOYkhwAr/bAu29HX/X68JW9H+6lCsP/mGGGH6ww+utNZ6JhgFARGCCBKYDoFohCSMSgYgyQETjji0aOoMh8xKRCTCDALAqGa+cmd0phg+Dhddc9SWCDde7i/so+r/q/b///99UACAD/8zjEUhOIkigBXtgAhFFHjACpFSMBTF/3UWHLUqVf5hCxcuEZYfoAwBAYDiwDRbAACIBAEAxWQFYBQEEcDsIuF8QbahYSKS8c8rmBcYSkIWIaOaMr+nfHKFzCtiGjmjK/mljdaZoTQ5w5xRL/8zjEYicCNn11mKgBKkVMv6CBummaIIG5FiLGJdLpkXi8j/00y4ggX00y4ggXy6XTIvF5Eul1IKv///5pBAekEB6QFhHCskxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/8zjEJQAAA0gBwAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';

/** The bytes of the built-in prompt sound; each time a new copy is returned, the caller will not pollute the next time if it is changed. */
export function testTone() {
  return new Uint8Array(Buffer.from(TEST_TONE_BASE64, 'base64'));
}

/**
 * Create a provider: Regardless of the text and speaking speed, the same prompt sound will be returned.
 * @returns can be passed directly to the definition of `voice.register` .
 */
export function createMockVoiceProvider() {
  return {
    id: 'mock-tone',
    name: 'Mock 提示音',
    async synthesize() {
      return testTone();
    },
  };
}
