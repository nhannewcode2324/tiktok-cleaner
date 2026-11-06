/**
 * Instant, event-driven cancellation controllers for Content Script operations.
 * Ensures clicking "Dừng quét" (Stop Scan), "Tạm dừng" (Pause), or "Dừng" (Stop Cleanup)
 * wakes up any pending sleep/scroll/wait in 0ms without completing extra iterations.
 */

let scanController = new AbortController();
let actionController = new AbortController();

export function resetScanAbort(): AbortSignal {
  scanController = new AbortController();
  return scanController.signal;
}

export function abortScan(): void {
  if (!scanController.signal.aborted) {
    scanController.abort();
  }
}

export function isScanAborted(): boolean {
  return scanController.signal.aborted;
}

export function getScanAbortSignal(): AbortSignal {
  return scanController.signal;
}

export function resetActionAbort(): AbortSignal {
  actionController = new AbortController();
  return actionController.signal;
}

export function abortAction(): void {
  if (!actionController.signal.aborted) {
    actionController.abort();
  }
}

export function isActionAborted(): boolean {
  return actionController.signal.aborted;
}

export function getActionAbortSignal(): AbortSignal {
  return actionController.signal;
}

/**
 * Sleeps up to `ms`, resolving `false` immediately (0ms latency) if `signal` aborts,
 * or `true` if the full duration elapsed without cancellation.
 */
export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function sleepUnlessScanAborted(ms: number): Promise<boolean> {
  return sleepWithAbort(ms, scanController.signal);
}

export function sleepUnlessActionAborted(ms: number): Promise<boolean> {
  return sleepWithAbort(ms, actionController.signal);
}
