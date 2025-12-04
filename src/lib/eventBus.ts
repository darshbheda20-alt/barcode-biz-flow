// Global event bus for cross-component refresh
const eventTarget = typeof window !== 'undefined' 
  ? (window as any).__appEvents || ((window as any).__appEvents = new EventTarget())
  : new EventTarget();

export function publishLocalEvent(name: string) {
  eventTarget.dispatchEvent(new Event(name));
}

export function listenLocalEvent(name: string, callback: () => void) {
  eventTarget.addEventListener(name, callback);
  return () => eventTarget.removeEventListener(name, callback);
}

export function publishRefreshAll() {
  publishLocalEvent('refresh-all');
}

export function publishTableRefresh(tableName: string) {
  publishLocalEvent(`refresh-${tableName}`);
}
