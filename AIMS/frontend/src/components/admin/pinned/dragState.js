/*
 * What is currently being dragged out of the strip.
 *
 * WHY THIS IS A MODULE VARIABLE AND NOT REACT STATE
 * -------------------------------------------------
 * react-grid-layout hands its onDrop callback the drop position and the
 * original DOM event, and the payload has to be readable at that instant. Two
 * routes exist and neither is sufficient alone:
 *
 *   - dataTransfer is the correct HTML5 mechanism, but `getData` returns an
 *     empty string during dragover in every browser (by design — the payload
 *     is protected until drop), and RGL calls onDropDragOver *before* the drop
 *     to size the placeholder. So the placeholder cannot be sized from it.
 *
 *   - React state would work for the placeholder, but a setState during
 *     dragstart is not guaranteed to have committed by the time the first
 *     dragover fires, so the first frame of the drag would size wrongly.
 *
 * A plain variable is readable synchronously from both callbacks, which is the
 * one property that matters here. It is set on dragstart and cleared on
 * dragend, so nothing survives the gesture — and there is only ever one drag
 * in flight, because a pointer cannot start a second one.
 *
 * The dataTransfer payload is still set by the strip: it is what makes the
 * browser treat the gesture as a genuine drag rather than a text selection,
 * and it is what a drop onto anything else would receive.
 */

let current = null;

/** Called on dragstart. `payload` is { savedQueryId, visual, w, h }. */
export const beginDrag = (payload) => { current = payload; };

/** What is in flight, or null. Safe to call at any point in a drag. */
export const peekDrag = () => current;

/** Called on dragend and after a drop. Idempotent. */
export const endDrag = () => { current = null; };
