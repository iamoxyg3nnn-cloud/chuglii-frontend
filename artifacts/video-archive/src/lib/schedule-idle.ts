/**
 * Schedule speculative work when the browser is idle, with cancellation.
 * A stale route/query must not continue downloading media after its prefetch
 * run has been superseded or the owning component has unmounted.
 */
export function scheduleIdle(
  work: () => void,
  timeout = 500,
  signal?: AbortSignal,
): void {
  if (typeof window === "undefined" || signal?.aborted) return;

  let idleHandle: number | undefined;
  let timerHandle: number | undefined;
  let settled = false;

  const cleanup = () => {
    if (idleHandle !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleHandle);
      idleHandle = undefined;
    }
    if (timerHandle !== undefined) {
      window.clearTimeout(timerHandle);
      timerHandle = undefined;
    }
    signal?.removeEventListener("abort", cancel);
  };

  const cancel = () => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  const run = () => {
    if (settled) return;
    settled = true;
    cleanup();
    if (!signal?.aborted) work();
  };

  if (typeof window.requestIdleCallback === "function") {
    idleHandle = window.requestIdleCallback(run, { timeout });
  } else {
    // Safari and older browsers: retain the existing short-delay fallback.
    timerHandle = window.setTimeout(run, 200);
  }

  signal?.addEventListener("abort", cancel, { once: true });
}
