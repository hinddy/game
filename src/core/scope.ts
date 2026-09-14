/** Reverse-order ownership, including listeners and in-flight work. Disposal is idempotent. */
export class Scope {
  private cleanups: Array<() => void> = [];
  private closed = false;
  readonly controller = new AbortController();
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  defer(cleanup: () => void): void {
    if (this.closed) cleanup();
    else this.cleanups.push(cleanup);
  }
  listen<T extends EventTarget>(
    target: T,
    type: string,
    listener: EventListener,
    options: AddEventListenerOptions = {},
  ): void {
    target.addEventListener(type, listener, {
      ...options,
      signal: this.signal,
    });
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.reverse()) {
      try {
        cleanup();
      } catch (e) {
        errors.push(e);
      }
    }
    this.cleanups.length = 0;
    if (errors.length)
      throw new AggregateError(errors, "Resource cleanup failed");
  }
}
