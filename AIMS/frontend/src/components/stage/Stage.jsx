import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The stage — shared background and viewport machinery for the two
 * pre-authentication screens that are single-screen compositions.
 *
 * Everything here is presentation with no product knowledge in it: the
 * landing page and the chooser both stand on this, and neither can tell the
 * other what the background does.
 */

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Where a generated ambient clip is looked for. Absent by default. */
export const STAGE_VIDEO = '/media/stage/ambient.mp4';

/**
 * Locks the document to the viewport while a single-screen page is mounted.
 *
 * It has to be done here and not in CSS, because `overflow: hidden` on <html>
 * is global: setting it in a stylesheet would follow the user into the
 * dashboards, which are long scrolling pages and would break outright. Scoped
 * to the lifetime of the component, and restored to whatever was there before
 * rather than to a hardcoded '' — the dashboards' own modals also touch this,
 * and clobbering their value on unmount would leave a locked page behind.
 *
 * WHY IT MEASURES INSTEAD OF ASKING A MEDIA QUERY
 * It used to lock above a fixed 880x620, on the reasoning that anything larger
 * had room. It does not. The recovery screen's card is about 760px tall on its
 * own, so at 1280x680 the lock hid the "Back to sign in" button below the fold
 * and removed the scrollbar that was the only way to reach it — content
 * clipped with no way to get to it, which is strictly worse than the scrollbar
 * the lock exists to remove.
 *
 * So the condition is the real one: lock only when the page already fits.
 * Measuring is safe because locking changes overflow and not layout — the one
 * second-order effect is the ~15px the vanishing scrollbar gives back, which
 * only ever makes more room, never less. It re-measures on resize, so turning
 * a window short releases the lock rather than trapping the footer.
 */
export function useViewportLock() {
  useEffect(() => {
    const { documentElement: html, body } = document;
    const prev = { html: html.style.overflow, body: body.style.overflow };
    let locked = false;

    const unlock = () => {
      if (!locked) return;
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      locked = false;
    };

    const measure = () => {
      // Always measure unlocked, or a locked page reports its clipped height
      // and would happily confirm that it fits.
      unlock();
      // 4px of slack, not zero. Sub-pixel layout and hairline borders routinely
      // report a page as two pixels too tall for its own viewport, and refusing
      // to lock over that is refusing to lock at all. Four pixels can hide a
      // border; it cannot hide a control.
      const fits = html.scrollHeight <= window.innerHeight + 4;
      if (fits) {
        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        locked = true;
      }
    };

    // Measured three times, because the page is three different heights on the
    // way in. Once after paint; once on a short timer; and once when the web
    // fonts have actually arrived — Manrope and Inter have different metrics
    // from the fallback stack, and the recovery screen came in a couple of
    // pixels over its own viewport on the fallback and under it on the real
    // face. Measuring only before that swap left a 2px scrollbar on a page
    // that fits.
    let live = true;
    const raf = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 350);
    document.fonts?.ready.then(() => { if (live) measure(); }).catch(() => {});

    // And once more whenever the page's own height changes. The three timed
    // measures above catch the three heights it is on the way in, but not a
    // fourth that arrives later — an icon font resolving, a reveal settling —
    // and a page that shrinks to fit after the last measure keeps a two-pixel
    // scrollbar on a document that no longer needs one. Guarded, because a
    // measure inside a ResizeObserver callback that itself changes layout is
    // how you write an infinite loop: `measure` only ever touches `overflow`,
    // which does not resize the element being observed.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(html);

    window.addEventListener('resize', measure);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
    };
  }, []);
}

/**
 * Ties the ambient clip's playhead to the scroll position.
 *
 * WHY SCRUB INSTEAD OF LOOP
 * A clip that loops on its own timer is wallpaper: it moves whether or not the
 * reader does, and after one cycle it has said everything it will ever say. A
 * scrubbed clip is the opposite — it only advances because the reader
 * advanced, so the footage behaves like the room the page is travelling
 * through rather than a screensaver behind it. Scrolling back rewinds it.
 * Stopping stops it.
 *
 * HOW IT AVOIDS BEING A SEEK STORM
 * Scroll fires far more often than a video can seek, so the raw position is
 * never handed straight to `currentTime`. A rAF loop eases the playhead toward
 * the target and only issues a seek when the gap is worth one — under about a
 * frame it does nothing at all. The loop parks itself once it has caught up
 * and is woken by the next scroll, so an idle page costs nothing.
 *
 * The element is paused for its whole life. `autoPlay` is deliberately absent:
 * a video that starts playing and is then seized by a scrub visibly stutters
 * on the first scroll.
 *
 * If the metadata never arrives — a missing file, a codec the browser will not
 * take — nothing here runs and the caller's poster/aurora carries the page.
 * There is no half-scrubbed state to fall into.
 */
export function useScrollScrub(ref, { enabled = true } = {}) {
  useEffect(() => {
    const v = ref.current;
    if (!v || !enabled || prefersReducedMotion()) return undefined;

    let raf = 0;
    let live = true;
    let span = 0;      // seconds of footage the page maps onto
    let shown = 0;     // where the playhead actually is
    let idle = true;

    const target = () => {
      const travel = document.documentElement.scrollHeight - window.innerHeight;
      if (travel <= 0) return 0;
      const p = Math.min(1, Math.max(0, window.scrollY / travel));
      return p * span;
    };

    const step = () => {
      if (!live) return;
      const want = target();
      // Ease rather than jump. A 1:1 mapping makes a fast flick look like a
      // dropped-frame mess; easing turns the same flick into a fast pan.
      shown += (want - shown) * 0.16;
      if (Math.abs(want - shown) < 0.008) shown = want;
      // Two guards, and the second one is the important one.
      //
      // `v.seeking` is checked because issuing a seek every frame cancels the
      // one already in flight, so the decoder restarts forever and never
      // finishes: measured against a full-page scroll the playhead landed at
      // 5.3s of an 8s clip and stayed there. Waiting for each seek to complete
      // costs a few frames of latency and actually arrives.
      //
      // The 0.05 is ~a frame and a half at 30fps; under that a seek is
      // invisible and only costs a decode.
      if (!v.seeking && Math.abs(v.currentTime - shown) > 0.05) {
        try { v.currentTime = shown; } catch { /* seeking before it is ready */ }
      }
      if (Math.abs(want - shown) < 0.004) {
        // One last seek on the way out, unconditionally. Parking the loop
        // while a seek is in flight to a stale value would leave the playhead
        // permanently a few frames behind where the reader stopped.
        try { v.currentTime = want; } catch { /* not ready */ }
        idle = true;
        return;
      }
      raf = requestAnimationFrame(step);
    };

    const wake = () => {
      if (!idle) return;
      idle = false;
      raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      // A hair short of the end: seeking to exactly `duration` lands on the
      // ended state in some browsers and blanks the last frame.
      span = v.duration - 0.06;
      v.pause();
      wake();
    };

    if (v.readyState >= 1) start();
    v.addEventListener('loadedmetadata', start);
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', wake);

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      v.removeEventListener('loadedmetadata', start);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', wake);
    };
  }, [ref, enabled]);
}

/**
 * The layered backdrop. Six planes, all behind the content in z-order, none of
 * them interactive.
 *
 * `accent` tints the third aurora mass and is expected to change as whatever
 * the page is showing changes, which is what keeps the ambient layer feeling
 * attached to the content rather than wallpapered behind it.
 */
export function StageBackdrop({ accent, hue, scrub = false }) {
  // Rendered optimistically and withdrawn on error. The clip is atmosphere,
  // so a missing file is a non-event: the aurora carries the movement alone
  // and nothing above ever knows the difference.
  const [hasVideo, setHasVideo] = useState(true);
  const video = useRef(null);
  useScrollScrub(video, { enabled: scrub && hasVideo });

  return (
    <>
      <div className="stage__base" aria-hidden="true" />
      {/* Scrubbed clips are never autoplayed and never loop: the scrub owns the
          playhead from the first frame, and a running clip fights it. */}
      {hasVideo && (
        <video
          ref={video}
          className="stage__video"
          src={STAGE_VIDEO}
          autoPlay={!scrub}
          loop={!scrub}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onError={() => setHasVideo(false)}
        />
      )}
      <div className="stage__grid" aria-hidden="true" />
      <div className="stage__aurora" aria-hidden="true" style={{ '--stage-accent': accent }}>
        <i /><i /><i />
      </div>
      <div className="stage__scrim" aria-hidden="true" style={hue ? { '--stage-hue': hue } : undefined} />
    </>
  );
}

/**
 * Drives an auto-advancing reel of `length` frames.
 *
 * Pauses on hover, focus or touch — an animation that keeps moving while
 * someone is reading the thing it is about is an animation fighting its own
 * reader. It also pauses when the tab is hidden, so returning to the tab
 * resumes where it left rather than at wherever a background timer wandered
 * to while nobody was watching.
 *
 * Under reduced motion the reel still advances. It carries the page's
 * feature copy, so freezing it would not calm the page, it would delete
 * content; the stylesheet drops the movement and keeps the cross-fade.
 */
export function useReel(length, dwell = 5200) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [swap, setSwap] = useState(0);

  const go = useCallback((n) => {
    setIndex(((n % length) + length) % length);
    setSwap((s) => s + 1);
  }, [length]);

  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % length);
      setSwap((s) => s + 1);
    }, dwell);
    return () => clearInterval(id);
  }, [paused, length, dwell]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const holdProps = {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocusCapture: () => setPaused(true),
    onBlurCapture: () => setPaused(false),
    onTouchStart: () => setPaused(true),
  };

  return { index, swap, paused, go, holdProps };
}

/**
 * Preloads the reel's images once, so the first advance is not a blank pane.
 * Deliberately fire-and-forget: a frame that fails to load simply never
 * appears, and the reel is still legible without it.
 */
export function usePreload(sources) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    sources.forEach((src) => { const img = new Image(); img.src = src; });
  }, [sources]);
}
