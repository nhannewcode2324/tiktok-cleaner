/**
 * Result Verifier — generic "wait until the page reflects the expected state" helpers.
 * Every destructive click is preceded by a state read and followed by a verification.
 */

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  /** Optional root to observe with MutationObserver for faster reaction. */
  root?: Node;
}

export function waitFor<T>(probe: () => T | null | undefined | false, opts: WaitOptions = {}): Promise<T | null> {
  const timeout = opts.timeout ?? 8000;
  const interval = opts.interval ?? 150;
  return new Promise((resolve) => {
    let done = false;
    let observer: MutationObserver | null = null;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(killer);
      observer?.disconnect();
      resolve(v);
    };
    const check = () => {
      try {
        const v = probe();
        if (v) finish(v as T);
      } catch {
        /* keep waiting */
      }
    };
    const timer = setInterval(check, interval);
    const killer = setTimeout(() => finish(null), timeout);
    if (opts.root && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(check);
      observer.observe(opts.root, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    check();
  });
}

export type TriState = 'on' | 'off' | 'unknown';

/**
 * Waits until `read()` returns `expected` and stays there for `settleMs`
 * (TikTok sometimes flips state back when an action is rejected).
 */
export async function verifyTransition(
  read: () => TriState,
  expected: Exclude<TriState, 'unknown'>,
  opts: { timeout?: number; settleMs?: number; root?: Node } = {},
): Promise<boolean> {
  const ok = await waitFor(() => read() === expected, { timeout: opts.timeout ?? 6000, root: opts.root });
  if (!ok) return false;
  const settle = opts.settleMs ?? 1200;
  await new Promise((r) => setTimeout(r, settle));
  return read() === expected;
}
