/*
 * A cell that reports how tall its contents actually are.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Dashboard's built-in panels had no fixed height before this grid: they
 * sat in a plain CSS grid and were as tall as what they drew. A stat tile is
 * a label, a 32px figure and a line of supporting text; a proportion panel is
 * a heading, a bar and a legend; the activity feed is a scrolling list with a
 * 26rem ceiling. Three different heights, on purpose — that difference IS the
 * dashboard's hierarchy.
 *
 * Putting them in a row-based grid meant choosing a row count for each, which
 * is choosing a height, which is guessing. Guess low and the card clips its own
 * content; guess high and it becomes a mostly-empty rectangle. Both happened.
 *
 * So nothing guesses. The panel renders at its natural height, this measures
 * what that came to, and the grid is told. A tile whose supporting line wraps
 * to two lines grows by one line, because it really did.
 *
 * WHY ResizeObserver AND NOT A ONE-OFF MEASUREMENT
 * ------------------------------------------------
 * The height is not stable at first paint. Web fonts land, numbers arrive and
 * change how many lines the supporting text takes, and the column width
 * changes when the sidebar collapses — which re-wraps the text and changes the
 * height again. A measurement taken once in an effect would be a snapshot of
 * whichever of those had happened by then.
 *
 * WHY IT CANNOT LOOP
 * ------------------
 * The observed element is the CONTENT, and the height being set is the CELL's.
 * Content laid out at its natural height does not get taller because the box
 * around it did, so the measurement that follows a height change reports the
 * same number and the update stops. The caller also ignores sub-threshold
 * changes, so sub-pixel rounding cannot ping-pong.
 */

import { useEffect, useRef } from 'react';

export default function AutoHeightCell({ onMeasure, children }) {
  const ref = useRef(null);

  // Kept in a ref so a caller that passes a fresh arrow function on every
  // render does not tear down and rebuild the observer each time.
  const cbRef = useRef(onMeasure);
  cbRef.current = onMeasure;

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    /*
     * scrollHeight, not the observer's contentRect: the panels are absolutely
     * positioned in places and carry margins, and contentRect would report the
     * box this wrapper happens to have rather than the space its children
     * need.
     */
    const report = () => cbRef.current(node.scrollHeight);

    const observer = new ResizeObserver(report);
    observer.observe(node);

    // ResizeObserver fires on observe in every browser that ships it, but the
    // first callback can land after paint; measuring now avoids one frame at
    // the wrong height.
    report();

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="pin-measure">
      {children}
    </div>
  );
}
