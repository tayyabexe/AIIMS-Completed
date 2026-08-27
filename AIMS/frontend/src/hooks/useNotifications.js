import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Shared notification read-state for the AIMS portals.
 *
 * Items: { id, type, title, message, time, read, ... }
 *
 * Every caller passing the same `storageKey` shares one store, so marking a
 * notification read in the header bell immediately updates the portal's
 * Notifications page and vice versa. Each hook instance used to hold its own
 * useState copy, which meant the two views disagreed until a remount.
 *
 * Read status is persisted to localStorage under `storageKey` so it survives a
 * refresh, and `storage` events keep other open tabs in step.
 */

// storageKey -> { ids: Set<string|number>, listeners: Set<fn> }
const stores = new Map();

const read = (storageKey) => {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
};

const getStore = (storageKey) => {
  let store = stores.get(storageKey);
  if (!store) {
    store = { ids: read(storageKey), listeners: new Set() };
    stores.set(storageKey, store);
  }
  return store;
};

const emit = (store) => store.listeners.forEach((fn) => fn());

const write = (storageKey, ids) => {
  const store = getStore(storageKey);
  // A new Set identity is required so useSyncExternalStore sees a change.
  store.ids = ids;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — state still works for this session */
  }
  emit(store);
};

// Another tab marking something read should update this one too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || !stores.has(e.key)) return;
    const store = getStore(e.key);
    store.ids = read(e.key);
    emit(store);
  });
}

export default function useNotifications(initialItems, storageKey) {
  const subscribe = useCallback(
    (listener) => {
      const store = getStore(storageKey);
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [storageKey],
  );

  const getSnapshot = useCallback(() => getStore(storageKey).ids, [storageKey]);

  const readIds = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const items = useMemo(
    () => initialItems.map((n) => ({ ...n, read: Boolean(n.read || readIds.has(n.id)) })),
    [initialItems, readIds],
  );

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  /** Mark a single notification as read. */
  const markRead = useCallback(
    (id) => {
      const current = getStore(storageKey).ids;
      if (current.has(id)) return;
      write(storageKey, new Set(current).add(id));
    },
    [storageKey],
  );

  /** Flip a notification back to unread. */
  const markUnread = useCallback(
    (id) => {
      const current = getStore(storageKey).ids;
      if (!current.has(id)) return;
      const next = new Set(current);
      next.delete(id);
      write(storageKey, next);
    },
    [storageKey],
  );

  /**
   * Mark every notification as read. Returns `true` when at least one
   * notification was actually marked (used to show a success message).
   */
  const markAllRead = useCallback(() => {
    if (unreadCount === 0) return false;
    write(storageKey, new Set(items.map((n) => n.id)));
    return true;
  }, [items, unreadCount, storageKey]);

  return { items, unreadCount, markRead, markUnread, markAllRead };
}
