/** Trusted factories are registered by the project; downloaded content contains data only. */
export class Registry<T> {
  private entries = new Map<string, T>();
  register(id: string, entry: T): void {
    if (!id || this.entries.has(id))
      throw new Error("Duplicate or empty registration: " + id);
    this.entries.set(id, entry);
  }
  get(id: string): T {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new Error("Unknown registration: " + id);
    return entry;
  }
  has(id: string): boolean {
    return this.entries.has(id);
  }
}
