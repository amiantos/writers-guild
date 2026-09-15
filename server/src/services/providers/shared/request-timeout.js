/**
 * Request timeouts for LLM APIs
 *
 * A stalled request doesn't fail on its own: the connection stays open,
 * keep-alive comments may keep arriving, and no tokens ever do. These timeouts
 * turn that into an error the reader sees, instead of a generation that never
 * ends.
 */

/** How long a stream may go without sending data before it counts as stalled. */
export const STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * How long a non-streaming request may take. Nothing arrives until the whole
 * response is ready, so this leaves room for a long generation.
 */
export const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Start a timeout for one request. Its signal aborts when the timer runs out or
 * when the caller's own signal does. Streams call reset() whenever data
 * arrives. After a failure, `timedOut` tells a timeout apart from a
 * cancellation.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal] - The caller's cancellation signal.
 * @returns {{ signal: AbortSignal, timedOut: boolean, reset: () => void, clear: () => void }}
 */
export function createRequestTimeout(ms, signal) {
  const controller = new AbortController();
  let timer = null;

  const timeout = {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    timedOut: false,
    reset() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // A request the caller already cancelled stays cancelled.
        if (signal?.aborted) return;
        timeout.timedOut = true;
        // A TimeoutError, like AbortSignal.timeout(), so it isn't taken for a cancellation.
        controller.abort(new DOMException('The request timed out', 'TimeoutError'));
      }, ms);
      // The timer alone shouldn't keep the process running.
      timer.unref();
    },
    clear() {
      clearTimeout(timer);
    },
  };

  timeout.reset();
  return timeout;
}

/** A timeout in words for error messages, like "2 minutes" or "30 seconds". */
export function formatTimeout(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
