/**
 * Creates a reusable operation tracker for services that support
 * single-active-operation with cancellation.
 * Prevents unbounded Set growth by cleaning up cancelled entries.
 */
export function createOperationTracker(prefix: string) {
  const cancelledOperations = new Set<string>();
  let activeOperationId: string | null = null;
  let operationCounter = 0;

  return {
    generateId(): string {
      operationCounter++;
      return `${prefix}-${Date.now()}-${operationCounter}`;
    },

    start(operationId: string): void {
      activeOperationId = operationId;
      cancelledOperations.delete(operationId);
    },

    finish(): void {
      if (activeOperationId) {
        cancelledOperations.delete(activeOperationId);
      }
      activeOperationId = null;
    },

    isCancelled(operationId: string): boolean {
      return cancelledOperations.has(operationId);
    },

    requestCancel(): boolean {
      if (!activeOperationId) return false;
      cancelledOperations.add(activeOperationId);
      return true;
    },

    isRunning(): boolean {
      return activeOperationId !== null;
    },

    getActiveId(): string | null {
      return activeOperationId;
    },

    /** Clean up stale entries to prevent memory leaks */
    cleanup(): void {
      cancelledOperations.clear();
    },
  };
}
