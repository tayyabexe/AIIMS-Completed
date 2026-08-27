import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  AvatarCropper — position and size the picture before it is uploaded
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY IT EXISTS
 * -------------
 * Choosing a file used to upload it whole. Everywhere an avatar is drawn it is
 * drawn in a circle with `object-fit: cover`, so the browser cropped the
 * picture at display time — always to the exact centre, and differently at
 * every size the avatar appears in. A photograph with the subject off to one
 * side, or a tall portrait, came out as an ear and a shoulder, and there was
 * nothing the person could do about it.
 *
 * The crop belongs BEFORE the upload, for two reasons beyond framing:
 *
 *   1. The bytes stored are then the picture that will actually be seen. One
 *      square is served to the header, the roster and the profile page, instead
 *      of three different crops of a rectangle.
 *   2. A 4000×3000 phone photograph becomes a 512×512 square. That is the
 *      difference between a 6MB row and a 60KB one — and this is also where the
 *      1MB rule lands, because a re-encoded 512px square is under it by a wide
 *      margin whatever was fed in.
 *
 * HOW IT WORKS
 * ------------
 * The image sits behind a fixed circular window. Dragging moves the image under
 * the window; the wheel and the slider scale it. The window never moves — it is
 * the crop, so it stays where the eye has already settled.
 *
 * WHAT IS DELIBERATE
 * ------------------
 * `minScale` is computed so the image ALWAYS covers the circle, and the offset
 * is clamped to the same rule. There is no way to drag a transparent gap into
 * frame, so there is no invalid crop to validate against or explain.
 *
 * The output is drawn from the ORIGINAL bitmap through `drawImage`, not from
 * the on-screen preview. The preview is 260px; sampling it would throw away
 * most of the detail before the file is even made.
 *
 * INPUT THAT IS NOT A MOUSE
 * -------------------------
 * Pointer events cover mouse, pen and touch with one code path. The zoom slider
 * exists because a wheel is not available on a phone and is awkward on a
 * trackpad, and it is a real `<input type="range">`, so the whole thing is
 * reachable from the keyboard.
 */

/** The circular window, in CSS pixels. */
const VIEW = 260;

/**
 * The stored square, in image pixels.
 *
 * 512 is chosen against how it is actually used: the largest an avatar is ever
 * drawn in this product is the 148px picker target, and the largest on any real
 * screen is the 96px faculty profile. 512 covers all of them at 2× device pixel
 * ratio with room to spare, and refuses to store the other 15 megapixels of a
 * phone camera that nothing will ever display.
 */
const OUT = 512;

/** How far in a picture may be zoomed, relative to "just covers the circle". */
const MAX_ZOOM = 4;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {string}   src        object URL of the chosen file
 * @param {string}   [fileName] carried onto the produced File
 * @param {function} onReady    (cropFn) => void — hands the parent a function
 *                              that returns a Promise<File> of the current crop
 */
export default function AvatarCropper({ src, fileName = 'avatar.jpg', onReady }) {
  const [natural, setNatural] = useState(null);   // { w, h } of the source
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const imgRef = useRef(null);
  const frameRef = useRef(null);
  const dragFrom = useRef(null);

  // Kept in refs as well as state so the crop function handed to the parent
  // always reads the latest values without being rebuilt on every pointer move.
  const view = useRef({ scale: 1, offset: { x: 0, y: 0 }, natural: null });
  view.current = { scale, offset, natural };

  /* ── the image's own size decides the floor ───────────────────────────────
     A picture must cover the circle at every zoom level, so the smallest
     allowed scale is whatever makes its SHORTER side exactly the diameter. */
  const onLoad = useCallback((e) => {
    const w = e.target.naturalWidth;
    const h = e.target.naturalHeight;
    const fit = VIEW / Math.min(w, h);

    setNatural({ w, h });
    setMinScale(fit);
    setScale(fit);
    // Centred to begin with, which is the crop most people want and the one
    // the browser used to force on everybody.
    setOffset({ x: 0, y: 0 });
  }, []);

  /* ── the offset can never expose an edge ──────────────────────────────── */
  const clampOffset = useCallback((next, atScale) => {
    if (!natural) return { x: 0, y: 0 };

    const dispW = natural.w * atScale;
    const dispH = natural.h * atScale;

    // Half the overhang on each axis. Zero when the image exactly covers, so
    // a fully zoomed-out picture simply cannot be dragged.
    const maxX = Math.max(0, (dispW - VIEW) / 2);
    const maxY = Math.max(0, (dispH - VIEW) / 2);

    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, [natural]);

  const applyScale = useCallback((next) => {
    const bounded = clamp(next, minScale, minScale * MAX_ZOOM);
    setScale(bounded);
    // Re-clamped against the NEW scale: zooming out shrinks the overhang, and
    // an offset that was legal a moment ago would otherwise pull an edge into
    // frame.
    setOffset((current) => clampOffset(current, bounded));
  }, [minScale, clampOffset]);

  /* ── drag ─────────────────────────────────────────────────────────────── */
  const onPointerDown = (e) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragFrom.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragFrom.current) return;
    setOffset(clampOffset(
      { x: e.clientX - dragFrom.current.x, y: e.clientY - dragFrom.current.y },
      scale,
    ));
  };

  const endDrag = (e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragFrom.current = null;
    setDragging(false);
  };

  /* ── wheel ────────────────────────────────────────────────────────────────
     Bound with { passive: false } through a ref rather than as an onWheel
     prop, because React attaches its wheel listener passively and
     preventDefault is a no-op there — without it the page scrolls behind the
     dialog while the picture is being zoomed. */
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;

    const onWheel = (e) => {
      e.preventDefault();
      // Multiplicative, so one notch feels the same at every zoom level. An
      // additive step crawls when zoomed in and jumps when zoomed out.
      applyScale(view.current.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [applyScale]);

  /* ── keyboard ─────────────────────────────────────────────────────────── */
  const onKeyDown = (e) => {
    const STEP = e.shiftKey ? 20 : 6;

    const nudge = (dx, dy) => {
      e.preventDefault();
      setOffset((c) => clampOffset({ x: c.x + dx, y: c.y + dy }, scale));
    };

    if (e.key === 'ArrowLeft') nudge(STEP, 0);
    else if (e.key === 'ArrowRight') nudge(-STEP, 0);
    else if (e.key === 'ArrowUp') nudge(0, STEP);
    else if (e.key === 'ArrowDown') nudge(0, -STEP);
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); applyScale(scale * 1.15); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyScale(scale / 1.15); }
  };

  const reset = () => { applyScale(minScale); setOffset({ x: 0, y: 0 }); };

  /* ── produce the file ─────────────────────────────────────────────────────
     The maths, once:

       the circle shows VIEW css px of a picture drawn at `scale`, so it covers
       VIEW / scale pixels of the ORIGINAL bitmap;

       dragging by `offset` css px moved the image, so the centre of the window
       sits offset/scale original-pixels away from the image's own centre, in
       the opposite direction.

     That gives the source square handed to drawImage. Everything is taken from
     the original bitmap, never from the 260px preview. */
  const crop = useCallback(async () => {
    const { scale: s, offset: o, natural: n } = view.current;
    const image = imgRef.current;

    if (!image || !n) throw new Error('The picture is still loading.');

    const side = VIEW / s;
    const sx = (n.w / 2) - (o.x / s) - (side / 2);
    const sy = (n.h / 2) - (o.y / s) - (side / 2);

    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;

    const ctx = canvas.getContext('2d');

    // Best available resampling. A 4000px photo scaled to 512 with the default
    // 'low' setting is visibly soft.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    /*
     * White underneath, because the output is JPEG and JPEG has no alpha. A
     * transparent PNG drawn straight onto an empty canvas encodes its
     * transparent pixels as BLACK, which is how a logo with a clear background
     * becomes a black square.
     */
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, OUT, OUT);

    ctx.drawImage(image, sx, sy, side, side, 0, 0, OUT, OUT);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('The picture could not be prepared.'))),
        // JPEG at 0.92: visually indistinguishable at avatar sizes and a small
        // fraction of the size of the PNG the canvas would otherwise produce.
        'image/jpeg',
        0.92,
      );
    });

    const base = String(fileName).replace(/\.[^.]+$/, '') || 'avatar';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  }, [fileName]);

  // Handed up once the source is measured. Before that there is nothing to
  // crop, and the parent uses its absence to keep Save disabled.
  useEffect(() => {
    onReady?.(natural ? crop : null);
  }, [natural, crop, onReady]);

  const dispW = natural ? natural.w * scale : VIEW;
  const dispH = natural ? natural.h * scale : VIEW;

  return (
    <div className="avc">
      <div
        ref={frameRef}
        className={`avc-frame${dragging ? ' is-dragging' : ''}`}
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="application"
        aria-label="Position the picture. Drag to move, scroll or use the slider to zoom, arrow keys to nudge."
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          onLoad={onLoad}
          draggable={false}
          className="avc-img"
          style={{
            width: dispW,
            height: dispH,
            left: `calc(50% - ${dispW / 2}px + ${offset.x}px)`,
            top: `calc(50% - ${dispH / 2}px + ${offset.y}px)`,
          }}
        />

        {/*
          The mask, not a border.

          A ring drawn on top would leave the parts of the picture that will be
          cut still fully visible, so the crop would not be obvious until after
          it was applied. Dimming everything outside the circle shows the result
          directly: what is bright is what gets stored.
        */}
        <span className="avc-mask" aria-hidden="true" />
      </div>

      <div className="avc-controls">
        <button
          type="button"
          className="avc-zoom-btn"
          onClick={() => applyScale(scale / 1.2)}
          disabled={!natural || scale <= minScale + 0.0001}
          aria-label="Zoom out"
        >
          <ZoomOut size={15} />
        </button>

        <input
          type="range"
          className="avc-slider"
          min={minScale}
          max={minScale * MAX_ZOOM}
          step={(minScale * (MAX_ZOOM - 1)) / 100 || 0.01}
          value={scale}
          disabled={!natural}
          onChange={(e) => applyScale(Number(e.target.value))}
          aria-label="Zoom"
        />

        <button
          type="button"
          className="avc-zoom-btn"
          onClick={() => applyScale(scale * 1.2)}
          disabled={!natural || scale >= minScale * MAX_ZOOM - 0.0001}
          aria-label="Zoom in"
        >
          <ZoomIn size={15} />
        </button>

        <button
          type="button"
          className="avc-zoom-btn"
          onClick={reset}
          disabled={!natural}
          aria-label="Reset the framing"
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="avc-hint">Drag to move · scroll or use the slider to zoom</p>
    </div>
  );
}
