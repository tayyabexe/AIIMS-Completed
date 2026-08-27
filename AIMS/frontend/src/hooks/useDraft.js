/*
 * Offline draft persistence for forms.
 *
 * THE PROBLEM
 * -----------
 * Every form in this system holds its work in React state and nothing else.
 * Close the tab, lose power, let the laptop sleep until the tab is discarded,
 * or simply mis-click a nav link, and everything typed is gone. That is worst
 * on the long data-entry screens — a faculty attendance register for a section
 * of forty, or a marks sheet — where a lost form is an hour of work.
 *
 * WHAT THIS DOES
 * --------------
 * Mirrors the form's state into localStorage as it is edited, and offers it
 * back the next time the same form is opened. localStorage is synchronous and
 * survives a process kill, so a draft written before the machine dies is on
 * disk; sessionStorage would not survive, and an IndexedDB write can still be
 * in flight when the tab goes away.
 *
 * Drafts are namespaced per signed-in account, so two people sharing a browser
 * never see each other's work, and are cleared on submit.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not replay writes to the server when connectivity returns. A queued
 * POST that fires later, unattended, can duplicate a payment or re-mark a
 * register — that needs server-side idempotency keys to be safe, which this
 * system does not have. The draft is restored and the person presses Save, so
 * a human always confirms what goes to the database.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStoredUser } from '../api/session';

const PREFIX = 'aims.draft';
const INDEX_KEY = `${PREFIX}.index`;

// Drafts older than this are dropped when the index is next swept, so a form
// abandoned months ago does not resurface as a surprise.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const readUserScope = () => {
  // Read THIS TAB's user, not a shared localStorage seed — the seed is now
  // per-portal (see api/session.js) and the bare `aims.user` key no longer
  // exists. getStoredUser() is the per-tab identity, which is the correct scope
  // for a draft anyway: a draft belongs to the person typing it in this tab.
  try {
    const user = getStoredUser();
    return user?.userId ? `u${user.userId}` : 'anon';
  } catch {
    return 'anon';
  }
};

const storageKey = (name) => `${PREFIX}.${readUserScope()}.${name}`;

// ---------------------------------------------------------------- the index
// A list of live draft keys, so "you have unsaved work" can be answered without
// walking the whole of localStorage on every page load.

const readIndex = () => {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeIndex = (index) => {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* quota — the draft itself matters more than the index */
  }
};

const touchIndex = (key, savedAt) => {
  const index = readIndex();
  index[key] = savedAt;
  writeIndex(index);
};

const dropFromIndex = (key) => {
  const index = readIndex();
  delete index[key];
  writeIndex(index);
};

/** Removes expired drafts. Called once per mount; cheap, and self-healing. */
const sweep = () => {
  const index = readIndex();
  const cutoff = Date.now() - MAX_AGE_MS;
  let changed = false;

  for (const [key, savedAt] of Object.entries(index)) {
    if (!savedAt || new Date(savedAt).getTime() < cutoff) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      delete index[key];
      changed = true;
    }
  }

  if (changed) writeIndex(index);
};

/** Whether any draft is currently stored for the signed-in account. */
export function listDrafts() {
  const scope = `${PREFIX}.${readUserScope()}.`;
  return Object.entries(readIndex())
    .filter(([key]) => key.startsWith(scope))
    .map(([key, savedAt]) => ({ key, name: key.slice(scope.length), savedAt }))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

// ------------------------------------------------------------------- online

/** Live connectivity, for the "you are offline" hint on a form. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

// -------------------------------------------------------------------- draft

/**
 * @param name    stable id for this form, e.g. 'admin.student.new'
 * @param value   the form state to persist
 * @param options {
 *   enabled,      pause saving (a closed modal should not overwrite a draft)
 *   debounceMs,   how long after the last keystroke to write
 *   isEmpty,      (value) => bool — an untouched form must not create a draft
 *   onRestore,    (draft) => void — receives a draft found on mount
 *   autoRestore,  call onRestore automatically (default true)
 * }
 */
export function useDraft(name, value, options = {}) {
  const {
    enabled = true,
    debounceMs = 600,
    isEmpty,
    onRestore,
    autoRestore = true,
  } = options;

  const key = useMemo(() => storageKey(name), [name]);

  const [savedAt, setSavedAt] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | saving | saved
  const [restored, setRestored] = useState(null);

  // Kept in refs so the save effect depends on the value alone — these are
  // redefined on every render at the call sites.
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // A draft must not be written back before the stored one has been read, or
  // the first render's empty state would overwrite the saved work.
  const hydrated = useRef(false);

  /*
   * Restore when the form becomes ACTIVE, not when the component mounts.
   *
   * THE BUG THIS FIXES
   * ------------------
   * Every drafted form in this system lives in a modal, and the hook is called
   * from the component that owns the modal — which mounts long before the
   * modal opens. So the restore below used to run on mount, with the dialog
   * shut, and hand the saved values to a form nobody was looking at. Then the
   * user clicked Edit, the open handler seeded the form from the server record
   * (student.Profile does exactly this, and so does every screen that shows
   * current values for editing), and the restored draft was overwritten before
   * it was ever seen.
   *
   * The result was the reported symptom precisely: work typed into a student
   * portal form, lost to a closed tab or a dropped connection, was still on
   * disk — `hasDraft` was true, the "unsaved work" notice appeared — but the
   * fields showed the server's values instead of what had been typed.
   *
   * Keying the effect on `enabled` means the draft is applied when the form is
   * opened, after that seeding, which is the only moment the values are the
   * ones on screen. `enabled` already gated saving for the same reason; it
   * simply was not gating the read.
   *
   * `restoredAt` is compared so re-opening the modal in one session re-offers
   * the draft rather than restoring only once per mount, and so clear() —
   * which nulls `restored` — does not immediately re-restore what it just
   * discarded.
   */
  const lastRestoredKey = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    sweep();

    // Already applied for this form in this activation. Without this the
    // effect would re-apply the stored draft on every re-render that changed
    // `key` identity, wiping edits made since it was offered.
    if (lastRestoredKey.current === key) return;
    lastRestoredKey.current = key;

    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.value !== undefined) {
          setRestored({ value: parsed.value, savedAt: parsed.savedAt });
          setSavedAt(parsed.savedAt);
          if (autoRestore && onRestoreRef.current) {
            onRestoreRef.current(parsed.value);
          }
        }
      }
    } catch {
      // A corrupt draft is discarded rather than blocking the form.
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }

    hydrated.current = true;
  }, [key, autoRestore, enabled]);

  /*
   * Closing the form re-arms the restore, so opening it again offers the draft
   * a second time. Without this, cancelling out of a half-filled dialog and
   * coming back to it would show an empty form while the draft still sat in
   * localStorage — visibly claiming unsaved work that the fields did not show.
   */
  useEffect(() => {
    if (!enabled) {
      lastRestoredKey.current = null;
      hydrated.current = false;
    }
  }, [enabled]);

  // ---- save on change ----
  const serialised = useMemo(() => {
    try {
      return JSON.stringify(value);
    } catch {
      return null; // non-serialisable state (a File, a DOM node) is not a draft
    }
  }, [value]);

  useEffect(() => {
    if (!enabled || !hydrated.current || serialised === null) return undefined;

    // An untouched form should not leave a draft behind — otherwise every
    // screen that was merely opened would claim to have unsaved work.
    const empty = isEmptyRef.current
      ? isEmptyRef.current(value)
      : serialised === '{}' || serialised === '[]' || serialised === 'null';

    if (empty) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      dropFromIndex(key);
      setSavedAt(null);
      setStatus('idle');
      return undefined;
    }

    setStatus('saving');

    const timer = setTimeout(() => {
      const stamp = new Date().toISOString();
      try {
        localStorage.setItem(key, JSON.stringify({ value, savedAt: stamp }));
        touchIndex(key, stamp);
        setSavedAt(stamp);
        setStatus('saved');
      } catch {
        // Out of quota, or storage blocked in a private window. The form still
        // works; it just cannot promise a draft, so it must not claim to.
        setStatus('idle');
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [serialised, enabled, key, debounceMs, value]);

  // ---- explicit controls ----

  /** Drop the stored draft. Call after a successful save to the server. */
  const clear = useCallback(() => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    dropFromIndex(key);
    setSavedAt(null);
    setRestored(null);
    setStatus('idle');
  }, [key]);

  /** Apply a draft that was found but not auto-applied. */
  const restore = useCallback(() => {
    if (restored && onRestoreRef.current) onRestoreRef.current(restored.value);
  }, [restored]);

  /*
   * Flush synchronously as the tab goes away.
   *
   * The debounced write above has up to `debounceMs` of unsaved keystrokes
   * outstanding at any moment, and the timer never fires if the page is being
   * torn down — which is exactly the "device goes off" case this is for.
   * `visibilitychange` is the reliable signal here: `beforeunload` and `unload`
   * are unreliable on mobile, where a backgrounded tab is often killed
   * outright without either ever firing.
   */
  useEffect(() => {
    if (!enabled) return undefined;

    const flush = () => {
      if (!hydrated.current || serialised === null) return;

      const empty = isEmptyRef.current
        ? isEmptyRef.current(value)
        : serialised === '{}' || serialised === '[]' || serialised === 'null';
      if (empty) return;

      const stamp = new Date().toISOString();
      try {
        localStorage.setItem(key, JSON.stringify({ value, savedAt: stamp }));
        touchIndex(key, stamp);
      } catch { /* ignore */ }
    };

    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled, key, serialised, value]);

  return {
    savedAt,
    status,
    /** The draft found on mount, or null. Survives auto-restore so the screen
     *  can say "restored from …" and offer to discard it. */
    restoredDraft: restored,
    hasDraft: !!restored,
    restore,
    clear,
    discard: clear,
  };
}

export default useDraft;
