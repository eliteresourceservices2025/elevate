// Saves exam answers one question at a time without losing any of them. The old runner kept a single "saved / saving / failed" flag,
// so a failed save of question 1 was shown as "Saved" as soon as question 2 went through, and the answer was missing when the exam was
// graded. Here every question is tracked on its own:
//  - one request per question at a time, always sending the newest choice (a quick second click never races the first);
//  - a failure is remembered for that question until a later save of it succeeds, and can be retried;
//  - "saved" is only true when nothing is waiting, in flight or failed.

export type SaveResult = { ok: boolean; error?: string; offline?: boolean };
export type SaveFn = (questionId: string, selected: string[]) => Promise<SaveResult>;

const key = (selected: string[]) => JSON.stringify([...selected].sort());

export class AnswerSaver {
  private wanted = new Map<string, string[]>();
  private confirmed = new Map<string, string>();
  private running = new Map<string, Promise<void>>();
  private failures = new Map<string, string | undefined>();

  constructor(
    private readonly save: SaveFn,
    private readonly onChange: () => void,
  ) {}

  /** What the server already has when the page opens (an exam picked up again). */
  seed(questionId: string, selected: string[]): void {
    this.wanted.set(questionId, selected);
    this.confirmed.set(questionId, key(selected));
  }

  /** The person chose this: remember it and send it. */
  choose(questionId: string, selected: string[]): void {
    this.wanted.set(questionId, selected);
    void this.flush(questionId);
  }

  flush(questionId: string): Promise<void> {
    const running = this.running.get(questionId);
    if (running) return running;
    // Started on a microtask, so the entry below is in place before this body can finish and remove it.
    const run = Promise.resolve().then(async () => {
      this.onChange();
      try {
        while (this.confirmed.get(questionId) !== key(this.wanted.get(questionId) ?? [])) {
          const sending = this.wanted.get(questionId) ?? [];
          const result = await this.save(questionId, sending);
          if (!result.ok) {
            this.failures.set(questionId, result.error);
            return;
          }
          this.confirmed.set(questionId, key(sending));
          this.failures.delete(questionId);
        }
        this.failures.delete(questionId);
      } finally {
        this.running.delete(questionId);
        this.onChange();
      }
    });
    this.running.set(questionId, run);
    return run;
  }

  /** Sends again every answer that failed. Resolves when they have all been tried. */
  async retryFailed(): Promise<void> {
    await Promise.all([...this.failures.keys()].map((q) => this.flush(q)));
  }

  /** Waits until nothing is in flight, then sends anything that failed once more. Returns true if every answer is saved. */
  async settle(): Promise<boolean> {
    await Promise.all([...this.running.values()]);
    if (this.failures.size > 0) await this.retryFailed();
    return this.failures.size === 0 && this.running.size === 0;
  }

  /** True while an answer is on its way or waiting to be sent. */
  get saving(): boolean {
    return this.running.size > 0;
  }

  /** The questions whose newest choice the server does not have. */
  get unsaved(): string[] {
    return [...this.wanted.keys()].filter((q) => this.confirmed.get(q) !== key(this.wanted.get(q) ?? []));
  }

  get failedCount(): number {
    return this.failures.size;
  }

  isUnsaved(questionId: string): boolean {
    return this.confirmed.get(questionId) !== key(this.wanted.get(questionId) ?? []);
  }

  lastError(): string | undefined {
    return [...this.failures.values()].find(Boolean);
  }
}
