/**
 * Browser side screenshot: capture a frame of the desktop, immediately stop the stream, and then give it to the same
 * set of budget codes.
 *
 * Only capture one frame and do not retain the stream; when the user deselects or the page policy prohibits
 * display-capture, an error is thrown, and the reason is displayed in the pop-up window (if the browser does not allow
 * it, upload can only be used instead).
 * @module dsh-pet/src/shared/chat/capture
 */
import { type EncodedImage, encodeCanvas } from './encode.ts';

/** Wait until the video actually has size. */
function waitForFrame(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    video.onloadeddata = () => resolve();
  });
}

/**
 * Capture a frame of the current screen.
 *
 * @returns Pictures that have been pressed into the budget.
 * When @throws is not supported by the environment, user cancels, or page policy prohibits display-capture.
 */
export async function captureDisplayFrame(): Promise<EncodedImage> {
  const media = navigator.mediaDevices;
  if (!media || typeof media.getDisplayMedia !== 'function')
    throw new Error('Screen capture is unavailable in this environment');
  const stream = await media.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await waitForFrame(video);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return encodeCanvas(canvas);
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
