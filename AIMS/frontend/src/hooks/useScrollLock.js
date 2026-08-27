import { useEffect } from 'react';

/*
 * Freezes the page behind a modal.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Every dialog in the portal is a fixed overlay drawn on top of a page that is
 * still scrollable. Opening "Edit teacher" and turning the wheel moved the
 * directory underneath instead of the form — and once the form's own content
 * had been scrolled to its end, the wheel handed the rest of the gesture to the
 * page behind it mid-scroll. Closing the dialog then left the reader somewhere
 * they never chose to be.
 *
 * WHY IT IS NOT JUST `overflow: hidden`
 * -------------------------------------
 * Setting `overflow: hidden` on <body> removes the scrollbar, and on a desktop
 * that is 15px of width the page instantly reclaims — every fixed header jumps
 * sideways as the dialog opens and jumps back as it closes. The gutter is
 * measured first and replaced with padding of the same width, so nothing moves.
 *
 * The previous inline values are captured and restored rather than being reset
 * to a hardcoded '' — two stacked dialogs (a delete confirmation raised from an
 * edit form) would otherwise have the inner one unlock the page on close while
 * the outer one is still open.
 *
 * @param locked  whether a modal is currently open
 */
export default function useScrollLock(locked) {
  useEffect(() => {
    if (!locked) return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;

    // The width the scrollbar was occupying. Zero on overlay-scrollbar
    // platforms (macOS trackpads, mobile), where no compensation is needed.
    const gutter = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (gutter > 0) {
      const current = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + gutter}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [locked]);
}
