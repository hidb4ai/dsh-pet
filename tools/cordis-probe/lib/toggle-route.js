/**
 * Switch routing: `GET` reads the current status, `POST` flips.
 *
 * Speech synthesis, speech recognition and memory each have a switch. The routing behavior of the three is exactly the
 * same, only the paths are different, so here we create handler according to the path without writing one copy for
 * each. Reason for existence: registered on host (Node), button on page - there is no direct channel between the two
 * halves, only a minimum route can be opened by host. Only serves this example and does not enter the interface of
 * dsh-pet.
 * @module dsh-cordis-probe/toggle-route
 */

/** The path of the voice synthesis switch (parallel with `/dsh-pet-7340` of dsh-pet, without interfering with each other). */
export const VOICE_ROUTE = '/cordis-probe-voice';
/** Path to speech recognition switch. */
export const SPEECH_ROUTE = '/cordis-probe-speech';
/** Path to memory switch. */
export const MEMORY_ROUTE = '/cordis-probe-memory';

/**
 * Build a switch processor.
 *
 * @param control - two functions of read and write switches; `setOn` returns the status after taking effect.
 * @returns can be directly passed to handler of `webServer.register` .
 */
export function createToggleHandler(control) {
  /** Additional status (such as the remembered capture count); if not implemented, an empty object is returned. */
  const extra = () => (typeof control.extra === 'function' ? control.extra() : {});
  return (req, res) => {
    if (req.method === 'GET') {
      respond(res, 200, { ok: true, on: control.isOn(), ...extra() });
      return;
    }
    if (req.method !== 'POST') {
      respond(res, 405, { ok: false, reason: 'method-not-allowed' });
      return;
    }
    // Without request body: clicking once means flipping once, eliminating parsing and verification.
    const on = control.setOn(!control.isOn());
    respond(res, 200, { ok: true, on, ...extra() });
  };
}

/** Write a JSON response. */
function respond(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}
