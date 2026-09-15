/**
 * A small, self-contained Undo/Redo stack for Shape Key values - kept
 * completely separate from LayerStackEngine's history (which is about
 * paint-layer canvas snapshots and knows nothing about morph scalars).
 * Mirrors the same proven design already used for layer opacity drags
 * (layerStackEngine.ts's beginOpacityChange/setOpacityLive): a snapshot of
 * "before" values is pushed once at the start of a change (one slider
 * drag, or one category/full reset), so however many live updates happen
 * inside that change collapse into exactly one Undo step.
 */

const MAX_HISTORY = 30;

export interface MorphHistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
}

export class MorphHistoryEngine {
  private undoStack: Array<Record<string, number>> = [];
  private redoStack: Array<Record<string, number>> = [];

  constructor(private readonly onStatusChange: (status: MorphHistoryStatus) => void) {}

  private notify() {
    this.onStatusChange({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  /** Call once at the start of a change (slider pointerdown, or right
   * before applying a category/full reset) with the CURRENT values of
   * every name about to change. */
  pushSnapshot(snapshot: Record<string, number>) {
    if (Object.keys(snapshot).length === 0) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** Pops the last snapshot and returns it (the values to restore). The
   * caller supplies the CURRENT values for exactly those same names so
   * they can be pushed onto the redo stack. */
  undo(currentValuesFor: (names: string[]) => Record<string, number>): Record<string, number> | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(currentValuesFor(Object.keys(entry)));
    if (this.redoStack.length > MAX_HISTORY) this.redoStack.shift();
    this.notify();
    return entry;
  }

  redo(currentValuesFor: (names: string[]) => Record<string, number>): Record<string, number> | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(currentValuesFor(Object.keys(entry)));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.notify();
    return entry;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
