export class PanelTimeout extends Error {
  constructor(ms: number) {
    super(`took longer than ${ms} ms`);
    this.name = "PanelTimeout";
  }
}

/** Rejects with PanelTimeout if the promise has not settled in `ms`. The work itself is not cancelled; the caller just stops waiting. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PanelTimeout(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
