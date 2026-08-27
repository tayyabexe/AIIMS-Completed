/*
 * The parent portal's shared scope: which family, and which child is being
 * looked at.
 *
 * WHY THE CHILD LIVES IN THE URL
 * ------------------------------
 * `selectedChildId` used to be a useState in the one component the whole
 * portal was made of. That was fine while there was one route, because there
 * was nothing to navigate between. With a route per module it would be the
 * same bug this batch is fixing everywhere else: the parent picks Usman,
 * opens Attendance, reloads or sends the link to their spouse, and the screen
 * quietly shows Bilal instead — the first child, not the one named on screen.
 *
 * So it is a query parameter, `?child=`. `/parent/attendance?child=3` is a
 * real address for "Usman's attendance": it survives a reload, Back and
 * Forward step through child changes, and the link can be sent.
 *
 * A parameter naming a child this account does not have is IGNORED rather
 * than honoured — the resolver below only ever returns a child out of
 * `myChildren`, which the API has already scoped to this parent. There is no
 * path here by which changing the number in the URL reaches another family's
 * record; the backend would refuse it too, but the screen should not even ask.
 */

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const ParentPortalContext = createContext(null);

export function ParentPortalProvider({ value, children }) {
  return (
    <ParentPortalContext.Provider value={value}>
      {children}
    </ParentPortalContext.Provider>
  );
}

/**
 * The portal scope: the parent's record, their children, and the child
 * currently in view.
 *
 * Throws nothing when used outside the layout — it returns the empty shape, so
 * a view rendered in isolation (a test, a storybook) degrades to "no children"
 * rather than crashing on a destructure.
 */
export function useParentPortal() {
  return useContext(ParentPortalContext) || {
    user: null,
    parentData: null,
    parentBundle: null,
    myChildren: [],
    selectedChild: null,
    selectedChildId: null,
    selectChild: () => {},
    childQuery: {},
  };
}

/**
 * Resolves the selected child from `?child=` against the children this account
 * actually has, and returns the setter that writes it back.
 *
 * Called once, by ParentLayout. Everything else reads it off the context, so
 * there is one resolution per render of the portal rather than one per view.
 *
 * @param {Array} myChildren  this parent's wards, already scoped by the API
 */
export function useChildSelection(myChildren) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('child');

  /*
   * The child in view.
   *
   * Falls back to the first ward when the parameter is absent, unparseable or
   * names somebody who is not this parent's child. The fallback is NOT written
   * back into the URL: a bare `/parent/attendance` is a legitimate address
   * meaning "my family", and rewriting it to `?child=1` on arrival would put a
   * junk entry in the history of every parent with one child.
   */
  const selectedChild = useMemo(() => {
    if (!myChildren.length) return null;

    const asNumber = Number(requested);
    const named = Number.isFinite(asNumber)
      ? myChildren.find((c) => c.id === asNumber)
      : null;

    return named || myChildren[0];
  }, [myChildren, requested]);

  /*
   * Changing child is a navigation, and `replace` is deliberate.
   *
   * Pushing would mean Back walks child-by-child through a list the parent
   * flicked past, instead of returning to the screen they came from. The
   * address still updates, so the link is still shareable and a reload still
   * lands on the right child; only the history entry is spared.
   *
   * Every other parameter on the URL is preserved — the fee screen and the
   * results screen carry their own, and switching child must not wipe them.
   */
  const selectChild = useCallback((id) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id == null) next.delete('child');
      else next.set('child', String(id));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  /*
   * The child parameter as a query object, for building links to other modules
   * that must stay pointed at the same child. `{}` when no child is selected,
   * so spreading it into a link is always safe.
   */
  const childQuery = useMemo(
    () => (selectedChild ? { child: String(selectedChild.id) } : {}),
    [selectedChild],
  );

  return { selectedChild, selectChild, childQuery };
}

/**
 * Appends the current child to a module path.
 *
 * Used by the sidebar and by the "view this child" affordances, so moving
 * between modules keeps the child you were looking at instead of snapping back
 * to the first one.
 */
export const withChild = (path, childId) => (
  childId == null ? path : `${path}?child=${childId}`
);
