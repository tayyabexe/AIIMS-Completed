/*
 * The state behind one customisable screen.
 *
 * THE SHAPE, AND WHY IT IS TWO THINGS AND NOT ONE
 * ----------------------------------------------
 * A card has an identity — which saved query or built-in panel it shows — and
 * a geometry, which is where it sits. Identity is one fact. Geometry is one
 * fact PER WIDTH: the same card is three columns wide on a monitor and the
 * full width of a tablet, and both are true at once.
 *
 * So `cards` holds identity, keyed by a uid, and `geometry` holds {x,y,w,h}
 * per breakpoint against that same uid. Rearranging at one width writes to one
 * half of the geometry and cannot touch the other. Flattening the two into a
 * single list of positioned cards — the obvious first design — means a tablet
 * session silently overwriting a desktop arrangement.
 *
 * The uid also solves React's problem: server card ids are reassigned on every
 * save (the write is a replace, see layout.service), so keying by them would
 * unmount and re-run every card on screen each time somebody nudged one. The
 * uid is minted once per card and kept for the life of the screen — which is
 * also why the save response is discarded rather than adopted.
 *
 * WHY SAVING IS AUTOMATIC
 * -----------------------
 * Dragging in a reflowing grid moves cards you did not touch, so there is no
 * moment where the arrangement is "half done" and worth discarding. A Save
 * button would mostly serve to lose work when someone navigates away, so the
 * layout is written a beat after the last change. "Reset layout" is the way
 * back, and it is one click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saved as savedApi, layout as layoutApi } from '../../../api/analytics';

// Long enough to swallow a burst of drags, short enough that leaving the
// screen straight after a change still catches it.
const AUTOSAVE_MS = 700;

const BREAKPOINTS = ['lg', 'sm'];

let uidSeq = 0;
const mintUid = () => `pin-${Date.now().toString(36)}-${(uidSeq += 1)}`;

/* What a card IS, never where it sits. */
const identityOf = (card, uid, autoHeight = false) => ({
  /*
   * Whether this card is as tall as its contents or as tall as the box it is
   * given. A property of the PANEL, not the screen: a stat tile has a natural
   * height and a chart does not. See BUILTINS in config/dashboardCards.js.
   */
  autoHeight,
  uid,
  kind: card.kind,
  builtinKey: card.builtinKey ?? null,
  label: card.label ?? null,
  savedQueryId: card.savedQueryId ?? null,
  visual: card.visual ?? null,
  /*
   * The height this card's contents actually need, measured after it renders.
   * Its floor, always — a card may be taller than its contents but never
   * shorter, because that is how a figure gets hidden. 0 means "not measured
   * yet".
   */
  minH: 0,
});

const geometryOf = (card) => ({
  x: card.x,
  y: card.y,
  w: card.w,
  h: card.h,
  // Whether a person chose this height, or the content did. See setCardHeight.
  userSized: card.userSized === true,
});

/* What a card is, for matching the two stored layouts onto each other. */
const keyOf = (c) => (c.builtinKey ? `b:${c.builtinKey}` : `q:${c.savedQueryId}:${c.visual}`);

/*
 * The server's two positioned lists become one identity list plus two geometry
 * maps. The lg layout defines identity — it is the complete set of cards.
 */
const ingest = (layouts, builtins = []) => {
  const lg = layouts?.lg || [];
  const sm = layouts?.sm || [];

  const autoByKey = new Map(builtins.map((b) => [b.key, b.autoHeight === true]));

  const cards = [];
  const geometry = { lg: {}, sm: {} };

  lg.forEach((card) => {
    const uid = mintUid();
    // A pinned query is always a chart or a table, and both fill their box.
    const auto = card.builtinKey ? autoByKey.get(card.builtinKey) === true : false;
    cards.push(identityOf(card, uid, auto));
    geometry.lg[uid] = geometryOf(card);
  });

  /*
   * Narrow geometry is matched by what the card IS, not by index — a stored sm
   * layout can be in a completely different order from the desktop one, which
   * is the whole point of it being arrangeable separately. Duplicates (the
   * same saved query pinned twice as the same chart) are handed out in order.
   */
  const byKey = new Map();
  cards.forEach((c) => {
    const k = keyOf(c);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c.uid);
  });

  const taken = new Set();
  sm.forEach((card) => {
    const queue = byKey.get(keyOf(card));
    const uid = queue?.find((u) => !taken.has(u));
    if (!uid) return;
    taken.add(uid);
    geometry.sm[uid] = geometryOf(card);
  });

  // Anything the narrow layout did not mention gets a full-width slot at the
  // bottom rather than being dropped off the screen.
  cards.forEach((c, i) => {
    if (!geometry.sm[c.uid]) {
      geometry.sm[c.uid] = { x: 0, y: i, w: 1, h: geometry.lg[c.uid].h, userSized: false };
    }
  });

  return { cards, geometry };
};

export function usePinnedSurface(surface) {

  const [savedQueries, setSavedQueries] = useState([]);
  const [cards, setCards] = useState([]);
  const [geometry, setGeometry] = useState({ lg: {}, sm: {} });
  const [rules, setRules] = useState(null);
  const [builtins, setBuiltins] = useState([]);

  // Serialises layout writes — see the autosave effect below.
  const chainRef = useRef(Promise.resolve());

  // Which width the grid is laid out at. RGL decides it from the measured
  // container and tells us; nothing here guesses from window size.
  const [breakpoint, setBreakpoint] = useState('lg');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);

  // 'idle' | 'saving' | 'saved' | 'error'
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');

  const timerRef = useRef(null);
  const aliveRef = useRef(true);

  /*
   * Which breakpoints have unsaved changes. A set rather than a boolean
   * because a session can legitimately touch both — arrange on a laptop, widen
   * the window, arrange again — and each has to be written to its own rows.
   *
   * Empty on load, which is what stops an admin who merely OPENED the screen
   * from writing a layout row: the server's "no rows means defaults" contract
   * depends on nothing being persisted until somebody changes something.
   */
  const dirtyRef = useRef(new Set());

  /*
   * `aliveRef` guards every setState that happens after an await.
   *
   * IT MUST BE RE-ARMED ON MOUNT, NOT ONLY CLEARED ON UNMOUNT. Written as a
   * cleanup-only effect this is an infinite spinner under StrictMode, which
   * mounts, unmounts and remounts every component in development: the first
   * cleanup set the flag false, the second mount never set it back, and the
   * `finally` below never reached setLoading(false). It survived a production
   * build and every API-level test, because neither double-invokes effects.
   */
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  // ------------------------------------------------------------ loading --

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      /*
       * One request. The layout response carries the saved-query library with
       * it, because a card holds a saved query's id and nothing else — without
       * the library there is no name to put on it. Against a remote database
       * an HTTP call costs a round trip however little it asks for.
       */
      const { layout } = await layoutApi.get(surface);
      if (!aliveRef.current) return;

      const ingested = ingest(layout.layouts, layout.builtins || []);

      setSavedQueries(layout.saved || []);
      setRules(layout.rules);
      setBuiltins(layout.builtins || []);
      setCards(ingested.cards);
      setGeometry(ingested.geometry);
      dirtyRef.current = new Set();

    } catch (e) {
      if (!aliveRef.current) return;
      setLoadError(e.message || 'The saved layout could not be loaded.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [surface]);

  useEffect(() => { load(); }, [load]);

  // ---------------------------------------------------------- autosaving --

  /* The wire shape for one breakpoint: identity joined back onto geometry. */
  const forWire = useCallback((bp) => cards.map((card) => {
    const g = geometry[bp]?.[card.uid] || { x: 0, y: 0, w: 1, h: 200 };
    return {
      kind: card.kind,
      builtinKey: card.builtinKey,
      savedQueryId: card.savedQueryId,
      visual: card.visual,
      x: g.x, y: g.y, w: g.w, h: g.h,
      userSized: !!g.userSized,
    };
  }), [cards, geometry]);

  /*
   * The wire payload, always read fresh at the moment a save actually runs.
   *
   * A save can sit queued behind an earlier one, and what should reach the
   * server is the arrangement as it stands when its turn comes, not a snapshot
   * from when it was scheduled.
   */
  const forWireRef = useRef(forWire);
  forWireRef.current = forWire;

  useEffect(() => {
    if (!dirtyRef.current.size) return undefined;

    clearTimeout(timerRef.current);
    setSaveState('saving');

    timerRef.current = setTimeout(() => {
      const pending = [...dirtyRef.current];
      if (!pending.length) return;

      /*
       * Claimed now, so a change made while this save is in the air marks the
       * layout dirty again and earns its own save rather than being folded
       * into this one and lost if this one fails.
       */
      dirtyRef.current = new Set();

      /*
       * ONE SAVE AT A TIME, ACROSS SCHEDULES AS WELL AS WITHIN ONE.
       *
       * The loop below was already sequential, but clearing the debounce timer
       * does not cancel a request already in flight: remove a card, then
       * restore it a second later, and the second save left the browser while
       * the first was still running.
       *
       * Both writes DELETE every row for this user and surface and re-insert
       * them. Two of those overlapping take gap locks on the same index range
       * in InnoDB and deadlock — MySQL kills one, and the layout that was
       * killed is the one the user is looking at. It surfaced as an occasional
       * 500 on PUT /analytics/layout and a board that silently failed to save.
       *
       * The chain makes overlap impossible. `.catch` before it so one failed
       * save does not poison every save after it.
       */
      chainRef.current = chainRef.current.catch(() => {}).then(async () => {
        try {
          for (const bp of pending) {
            // eslint-disable-next-line no-await-in-loop
            await layoutApi.save(surface, forWireRef.current(bp), bp);
          }

          if (!aliveRef.current) return;
          setSaveState('saved');
          setSaveError('');
        } catch (e) {
          if (!aliveRef.current) return;

          // Put them back: nothing was stored, so the layout is still dirty.
          dirtyRef.current = new Set([...dirtyRef.current, ...pending]);

          /*
           * The rejected arrangement stays on screen rather than being
           * reverted. The user is looking at what they just built; snapping it
           * back to the last stored version reads as the drag having failed,
           * when what happened is that the server refused the result. The
           * message says so.
           */
          setSaveState('error');
          setSaveError(e.message || 'That layout could not be saved.');
        }
      });
    }, AUTOSAVE_MS);

    return () => clearTimeout(timerRef.current);
  }, [cards, geometry, surface, forWire]);

  const markDirty = useCallback((bp) => {
    dirtyRef.current = new Set([...dirtyRef.current, bp]);
  }, []);

  // ------------------------------------------------------ card mutations --

  /*
   * POSITIONS after a drag or a compaction, for the width being arranged.
   *
   * RGL fires this on mount and on every container resize, not only on user
   * edits, so an unchanged layout must leave state identical — otherwise
   * opening the screen would mark it dirty and write it straight back.
   *
   * HEIGHT IS DELIBERATELY NOT READ FROM HERE
   * -----------------------------------------
   * It used to be, and it took a card's height from RGL's echo and any
   * difference as proof the resize handle had been dragged. Both were wrong,
   * and together they made a card impossible to shrink:
   *
   *   1. The echo lags. When a panel measured shorter than its starting height
   *      the new height went to RGL, RGL echoed back the height it still held,
   *      and this wrote the OLD number back over the measurement. The card
   *      never shrank. It only ever appeared to work for panels that measured
   *      TALLER, and those survived for an unrelated reason — `minH` forces
   *      RGL up to the content floor, so the echo already agreed.
   *
   *   2. It then recorded that echo as the user's intent. Merely opening the
   *      screen stamped `userSized` on every measured card and marked the
   *      layout dirty, so the autosave wrote a "customised" board for a person
   *      who had not touched anything — and, because `userSized` switches the
   *      measurement from "be this height" to "never go below it", froze each
   *      card at whatever height it had guessed on that first load.
   *
   * A real resize now arrives through `resizeCard`, from RGL's own
   * `onResizeStop` — the one event that means a person dragged the handle. See
   * CardGrid. Height here is left exactly as it was.
   */
  const applyGeometry = useCallback((rglLayout, bp) => {
    let changed = false;

    setGeometry((current) => {
      const at = current[bp] || {};
      const next = { ...at };

      rglLayout.forEach((l) => {
        const g = at[l.i];
        if (!g) return;
        if (g.x === l.x && g.y === l.y && g.w === l.w) return;

        changed = true;
        next[l.i] = { ...g, x: l.x, y: l.y, w: l.w };
      });

      if (!changed) return current;
      return { ...current, [bp]: next };
    });

    if (changed) markDirty(bp);
  }, [markDirty]);

  /*
   * A panel reporting the height its contents actually came to.
   *
   * Deliberately does NOT mark the layout dirty. This is a measurement, not an
   * edit — the user did not choose it, the content did. Treating it as a
   * change would have everyone who merely opened the screen write a layout row
   * on load, and would fire a save every time a font finished loading.
   */
  const setCardHeight = useCallback((uid, contentH) => {
    setCards((current) => current.map((c) => (
      c.uid === uid && Math.abs(c.minH - contentH) > 1 ? { ...c, minH: contentH } : c
    )));

    setGeometry((current) => {
      const next = {};
      let changed = false;

      BREAKPOINTS.forEach((bp) => {
        const g = current[bp]?.[uid];
        if (!g) { next[bp] = current[bp]; return; }

        /*
         * Untouched, the card simply IS its contents. Once someone has sized
         * it by hand that height is a decision, and the measurement only
         * raises the floor far enough to keep everything visible.
         */
        const h = g.userSized ? Math.max(g.h, contentH) : contentH;

        if (Math.abs(g.h - h) <= 1) { next[bp] = current[bp]; return; }

        changed = true;
        next[bp] = { ...current[bp], [uid]: { ...g, h } };
      });

      return changed ? next : current;
    });
  }, []);

  /** Put a saved query on the grid. `at` is the drop position from RGL. */
  const addCard = useCallback((savedQuery, visual, at, bp = 'lg') => {
    const uid = mintUid();
    const card = identityOf({ kind: 'query', savedQueryId: savedQuery.id, visual }, uid);

    // A table needs width to be worth reading; a chart is legible at half.
    const w = at?.w ?? (visual === 'table' ? 12 : 6);
    const h = at?.h ?? (visual === 'table' ? 416 : 336);

    setCards((current) => [...current, card]);

    setGeometry((current) => ({
      lg: {
        ...current.lg,
        [uid]: {
          x: bp === 'lg' ? (at?.x ?? 0) : 0,
          y: bp === 'lg' ? (at?.y ?? Infinity) : Infinity,
          w, h, userSized: false,
        },
      },
      sm: {
        ...current.sm,
        // Full width in the stack, at the end unless the stack is what is
        // being arranged right now.
        [uid]: {
          x: 0,
          y: bp === 'sm' ? (at?.y ?? Infinity) : Infinity,
          w: 1, h, userSized: false,
        },
      },
    }));

    // Both, because the card now exists at both widths.
    BREAKPOINTS.forEach(markDirty);
  }, [markDirty]);

  const removeCard = useCallback((uid) => {
    setCards((current) => current.filter((c) => c.uid !== uid));

    setGeometry((current) => {
      const next = {};
      BREAKPOINTS.forEach((bp) => {
        next[bp] = Object.fromEntries(
          Object.entries(current[bp] || {}).filter(([key]) => key !== uid),
        );
      });
      return next;
    });

    BREAKPOINTS.forEach(markDirty);
  }, [markDirty]);

  /*
   * A size chosen from the card's menu. Marks it user-sized, and is floored at
   * the content height — so picking "Small" on a card that needs more room
   * gives the smallest size that still shows everything, never a clipped one.
   */
  /*
   * `axis` is 'x' when only the width was dragged, 'xy' otherwise. It decides
   * whether the card becomes `userSized`.
   *
   * A measured card sits at the height of its contents and re-measures when
   * those contents change; `userSized` is what opts it out of that, so a height
   * someone chose is not overwritten. Widening a card is not choosing a height,
   * so a width-only drag must NOT set the flag — otherwise a stat tile pulled
   * one column wider stops tracking its own contents for good, and the only way
   * back is the "Fit to content" item in its menu.
   *
   * Defaults to 'xy', so any caller that has not been updated keeps exactly the
   * behaviour it had.
   */
  const resizeCard = useCallback((uid, w, h, bp = 'lg', axis = 'xy') => {
    const minH = cards.find((c) => c.uid === uid)?.minH || 0;

    setGeometry((current) => ({
      ...current,
      [bp]: {
        ...current[bp],
        [uid]: {
          ...current[bp][uid],
          // Width is meaningless in a single-column stack.
          w: bp === 'sm' ? 1 : w,
          h: Math.max(h, minH),
          userSized: axis === 'x'
            ? (current[bp][uid]?.userSized ?? false)
            : true,
        },
      },
    }));

    markDirty(bp);
  }, [cards, markDirty]);

  /*
   * Back to "as tall as what it holds" — the counterpart to resizing. Without
   * it, a card dragged to an awkward height could only be fixed by resetting
   * the whole screen.
   */
  const fitCardToContent = useCallback((uid, bp = 'lg') => {
    const minH = cards.find((c) => c.uid === uid)?.minH || 0;
    if (!minH) return;

    setGeometry((current) => ({
      ...current,
      [bp]: { ...current[bp], [uid]: { ...current[bp][uid], h: minH, userSized: false } },
    }));

    markDirty(bp);
  }, [cards, markDirty]);

  const setCardVisual = useCallback((uid, visual) => {
    setCards((current) => current.map((c) => (c.uid === uid ? { ...c, visual } : c)));
    BREAKPOINTS.forEach(markDirty);
  }, [markDirty]);

  /*
   * Put a removed built-in back. Appended at the bottom rather than returned
   * to its factory slot: the space it used to occupy has been filled by
   * whatever moved up into it, and dropping it back on top would displace
   * cards the user deliberately placed.
   */
  const restoreBuiltin = useCallback((key) => {
    const spec = builtins.find((b) => b.key === key);
    if (!spec || cards.some((c) => c.builtinKey === key)) return;

    const uid = mintUid();
    setCards((current) => [
      ...current,
      identityOf({ kind: 'builtin', builtinKey: key, label: spec.label }, uid,
        spec.autoHeight === true),
    ]);

    setGeometry((current) => ({
      lg: { ...current.lg, [uid]: { x: spec.x, y: Infinity, w: spec.w, h: spec.h, userSized: false } },
      sm: { ...current.sm, [uid]: { x: 0, y: Infinity, w: 1, h: spec.h, userSized: false } },
    }));

    BREAKPOINTS.forEach(markDirty);
  }, [builtins, cards, markDirty]);

  const resetLayout = useCallback(async () => {
    clearTimeout(timerRef.current);
    setSaveState('saving');

    try {
      const res = await layoutApi.reset(surface);
      if (!aliveRef.current) return;

      const ingested = ingest(res.layout.layouts, res.layout.builtins || builtins);
      dirtyRef.current = new Set();
      setCards(ingested.cards);
      setGeometry(ingested.geometry);
      if (res.layout.saved) setSavedQueries(res.layout.saved);
      setSaveState('idle');
      setSaveError('');
    } catch (e) {
      if (!aliveRef.current) return;
      setSaveState('error');
      setSaveError(e.message || 'The layout could not be reset.');
    }
  }, [surface]);

  // ----------------------------------------------- the saved-query library --

  /*
   * Renaming or re-ticking a saved query. Cards showing a template that was
   * just un-ticked move to one that survived, rather than being left pointing
   * at a view the server will refuse on the next save.
   */
  const updateSaved = useCallback(async (id, changes) => {
    const res = await savedApi.update(id, changes);
    const updated = res.saved;

    setSavedQueries((list) => list.map((s) => (s.id === id ? updated : s)));

    setCards((current) => {
      let changed = false;
      const next = current.map((card) => {
        if (card.savedQueryId !== id) return card;
        if (updated.visuals.includes(card.visual)) return card;
        changed = true;
        return { ...card, visual: updated.defaultVisual };
      });

      if (!changed) return current;
      BREAKPOINTS.forEach(markDirty);
      return next;
    });

    return updated;
  }, [markDirty]);

  /*
   * Deleting a saved query takes its cards with it on the server. The same is
   * done here so the screen matches without a reload — and dirty is
   * deliberately NOT set, because the cascade has already happened and
   * re-saving would only write back what the server just did.
   */
  const removeSaved = useCallback(async (id) => {
    await savedApi.remove(id);
    setSavedQueries((list) => list.filter((s) => s.id !== id));

    const doomed = new Set(
      cards.filter((c) => c.savedQueryId === id).map((c) => c.uid),
    );

    setCards((current) => current.filter((c) => !doomed.has(c.uid)));
    setGeometry((current) => {
      const next = {};
      BREAKPOINTS.forEach((bp) => {
        next[bp] = Object.fromEntries(
          Object.entries(current[bp] || {}).filter(([uid]) => !doomed.has(uid)),
        );
      });
      return next;
    });
  }, [cards]);

  const refreshSaved = useCallback(async () => {
    const res = await savedApi.list();
    if (aliveRef.current) setSavedQueries(res.saved || []);
  }, []);

  // ------------------------------------------------------------ derived ---

  const savedById = useMemo(
    () => new Map(savedQueries.map((s) => [s.id, s])),
    [savedQueries],
  );

  // Built-ins the user has removed, for the "add to this screen" menu.
  const hiddenBuiltins = useMemo(() => {
    const shown = new Set(cards.map((c) => c.builtinKey).filter(Boolean));
    return builtins.filter((b) => !shown.has(b.key));
  }, [builtins, cards]);

  /* RGL's `layouts` prop, rebuilt from identity + geometry. */
  const rglLayouts = useMemo(() => {
    const out = {};

    BREAKPOINTS.forEach((bp) => {
      out[bp] = cards.map((card) => {
        const g = geometry[bp]?.[card.uid] || { x: 0, y: Infinity, w: 1, h: 200 };
        return {
          i: card.uid,
          x: g.x, y: g.y, w: g.w, h: g.h,
          /*
           * The content floor. A card can be dragged taller but never shorter
           * than what it holds — this one line is what makes "no information
           * is ever left behind" true of every arrangement.
           */
          minH: card.minH || rules?.minHeight || 80,

          /*
           * Two columns, not three.
           *
           * Three was a sixth of the board, so a stat tile opened at its
           * minimum width and the west half of the resize range did not exist —
           * dragging its edge inward did nothing at all, which reads as a
           * broken handle rather than as a limit. Two still holds a figure and
           * its label at the narrowest breakpoint that shows twelve columns.
           */
          minW: bp === 'sm' ? 1 : 2,

          /*
           * Not read by the grid library — read by CardGrid, to decide whether
           * this card still measures its own height. See the `measured` line
           * there. It rides along here because the layout array is already the
           * per-breakpoint view of geometry that CardGrid holds.
           */
          userSized: !!g.userSized,
        };
      });
    });

    return out;
  }, [cards, geometry, rules]);

  return {
    savedQueries, savedById, cards, geometry, rglLayouts,
    rules, builtins, hiddenBuiltins,
    loading, loadError, reload: load,

    breakpoint, setBreakpoint,
    editing, setEditing,
    saveState, saveError,

    applyGeometry, addCard, removeCard, resizeCard, setCardVisual, setCardHeight,
    fitCardToContent, restoreBuiltin, resetLayout,

    updateSaved, removeSaved, refreshSaved,
  };
}

export default usePinnedSurface;
