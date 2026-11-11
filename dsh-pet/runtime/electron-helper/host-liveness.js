/**
 * Desktop Helper's "If the host is no longer available, it will be returned by itself" is a pure judgment.
 *
 * The stdout/stderr of Helper is the pipe given by the host. It disappears as soon as the host exits the reading end,
 * and the next write will get EPIPE; stream errors that are not monitored will become uncaught exceptions, and the
 * default processor of Electron only pops up the modal box and does not exit. Only judgments are placed here (not
 * require electron). The main process side is responsible for monitoring, polling and exiting.
 * @module dsh-pet/runtime/electron-helper/host-liveness
 */

'use strict';

/** Host survival detection interval (ms): The host is gone and converges at most 2 s, the cost is only one kill (pid, 0) every 2 s */
const HOST_POLL_MS = 2000;

/**
 * Inject when parsing host PID (DSH_PET_HOST_PID, host spawn). If it is invalid or not set, it returns 0, and the
 * caller does not perform detection accordingly - it would rather leave a desktop pet waiting for someone to close it
 * than retreat by mistake.
 */
function parseHostPid(raw) {
  const pid = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : 0;
}

/**
 * Are you sure the host main process is gone?
 *
 * `kill(pid, 0)` only performs existence check; only ESRCH is judged as "dead", EPERM and so on are all considered
 * alive, pid is invalid and false is also returned: this judgment must be preferred not to retreat.
 *
 * @param hostPid - host PID (a product of parseHostPid).
 * @param kill - Injectable for single testing.
 */
function hostIsGone(hostPid, kill = (pid, signal) => process.kill(pid, signal)) {
  if (!(hostPid > 0)) return false;
  try {
    kill(hostPid, 0);
    return false;
  } catch (error) {
    return Boolean(error) && error.code === 'ESRCH';
  }
}

/** Is this flow error "the pipe peer is gone": EPIPE and ERR_STREAM_DESTROYED both mean that the host is dead. */
function isBrokenPipeError(error) {
  const code = error && error.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

module.exports = { HOST_POLL_MS, parseHostPid, hostIsGone, isBrokenPipeError };
