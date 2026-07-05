/* Design Studio — document-level undo/redo.
   Snapshot-based (the document is an immutable tree, so "snapshots" are just
   references — no cloning). Pure data structure so the semantics are unit-
   testable; the editor owns when to record. Command-based history is the
   upgrade path if document size ever makes this heavy (components doc §A). */

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private capacity = 50) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record the state that is being replaced. Clears the redo branch. */
  record(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.capacity) this.past.shift();
    this.future = [];
  }

  /** Step back: returns the state to restore, or null. `current` is pushed
      onto the redo branch. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  /** Step forward: returns the state to restore, or null. */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
