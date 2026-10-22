/** Every partially-created scene has one idempotent cleanup, even if startup throws. */
export class CleanupScope {
  private tasks: Array<() => void> = [];
  private disposed = false;
  own(cleanup: () => void) { if (this.disposed) cleanup(); else this.tasks.push(cleanup); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.tasks.reverse()) { try { task(); } catch (error) { console.error('Resource cleanup failed', error); } }
    this.tasks = [];
  }
}
