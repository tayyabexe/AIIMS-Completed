import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

/*
 * A filter input whose placeholder can actually be read.
 *
 * THE PROBLEM
 * -----------
 * A native placeholder is clipped by the width of its box and there is no way
 * to see the rest of it — no wrap, no scroll, no tooltip. The filter boxes in
 * this portal ask questions like
 *
 *     "Search by name, department, course, or designation..."
 *
 * in a 280px field, which shows "Search by name, departme…" and hides the three
 * things the reader most needed to know were searchable. Widening the field is
 * not the fix: the longest hint here would need most of the header row, and the
 * screens that carry three filters side by side have nowhere to take it from.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * The placeholder is drawn as a real element sitting over the empty input,
 * inside its own horizontally scrollable strip. Long hints can be scrolled
 * end-to-end — by wheel, by trackpad swipe, or with the ‹ › nudges that appear
 * only when there is something off-screen to nudge towards. The strip draws no
 * scrollbar of its own: a bar sitting under a placeholder reads as a second
 * border on an empty field. Clicking anywhere on it focuses the
 * input, so it still behaves like a placeholder, and it stays visible while the
 * field is focused and empty, which is exactly when someone is deciding what to
 * type. The full text is also the field's `title`, so a hover reads it out in
 * one piece.
 *
 * Once something is typed the strip is gone and this is an ordinary input.
 */

const ACCENT = '#991b1b';

/*
 * The modern part: a field that responds.
 *
 * It was a flat 1px box that looked identical whether it was focused, hovered,
 * holding a filter or disabled — so nothing on screen told you which filters
 * were actually applied. Now the border lifts on hover, focus draws a soft ring
 * rather than the browser's default outline, and a field holding a value keeps
 * a tinted border so an active filter is visible at a glance across a row of
 * three. All state lives in one object below rather than being sprayed through
 * the JSX.
 */
const ring = ({ focused, filled, disabled }) => {
  if (disabled) return { borderColor: '#E2E8F0', boxShadow: 'none' };
  if (focused) {
    return {
      borderColor: ACCENT,
      boxShadow: `0 0 0 3px rgba(153, 27, 27, 0.10)`,
    };
  }
  if (filled) return { borderColor: '#FECACA', boxShadow: '0 1px 2px 0 rgba(15,23,42,0.04)' };
  return { borderColor: '#E2E8F0', boxShadow: '0 1px 2px 0 rgba(15,23,42,0.04)' };
};

export default function FilterField({
  value,
  onChange,
  placeholder = '',
  icon: Icon = Search,
  clearable = true,
  disabled = false,
  type = 'text',
  style = {},
  // Optional class on the wrapper. `style` alone cannot carry a media query,
  // and the admin attendance filter needs to go full-width on a narrow screen.
  className = '',
  inputStyle = {},
  ariaLabel,
  onKeyDown,
  ...rest
}) {
  const inputRef = useRef(null);
  const hintRef = useRef(null);
  const id = useId();
  const [focused, setFocused] = useState(false);

  // Whether the hint is wider than the strip showing it. Nothing about the
  // scroll affordance is drawn unless there is genuinely more text to reach.
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const empty = !String(value ?? '').length;

  /*
   * Which way there is more text.
   *
   * Measured rather than assumed, and re-measured on resize: the same hint
   * overflows in a three-filter row and does not in a one-filter header, and a
   * window drag moves a field between those two states without remounting it.
   */
  const measure = () => {
    const node = hintRef.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setOverflow({
      start: node.scrollLeft > 1,
      end: max > 1 && node.scrollLeft < max - 1,
    });
  };

  useEffect(() => {
    if (!empty) return undefined;
    measure();
    const node = hintRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, placeholder]);

  const nudge = (direction) => {
    const node = hintRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(node.clientWidth * 0.6, 60), behavior: 'smooth' });
  };

  const arrow = (side) => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(e) => { e.preventDefault(); nudge(side === 'left' ? -1 : 1); }}
      style={{
        position: 'absolute',
        [side]: 0,
        top: 0,
        bottom: 0,
        width: '18px',
        border: 'none',
        cursor: 'pointer',
        color: '#64748B',
        fontSize: '0.75rem',
        fontWeight: 800,
        lineHeight: 1,
        // Fades the text out under the arrow rather than cutting it, so it
        // reads as "there is more" instead of as a truncation bug.
        background: side === 'left'
          ? 'linear-gradient(to right, #FFFFFF 55%, rgba(255,255,255,0))'
          : 'linear-gradient(to left, #FFFFFF 55%, rgba(255,255,255,0))',
      }}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );

  return (
    <div className={className} style={{ position: 'relative', minWidth: 0, ...style }}>
      {Icon && (
        <Icon
          size={16}
          style={{
            position: 'absolute', left: '12px', top: '50%',
            transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 2,
            color: focused ? ACCENT : '#94A3B8',
            transition: 'color 150ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        />
      )}

      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        /* The native placeholder is deliberately empty: the strip below is the
           placeholder, and having both would draw the text twice. */
        placeholder=""
        title={placeholder}
        style={{
          width: '100%',
          padding: `0.5rem ${clearable && !empty ? '2.2rem' : '0.85rem'} 0.5rem ${Icon ? '2.35rem' : '0.85rem'}`,
          border: '1px solid #E2E8F0',
          borderRadius: '9px',
          fontSize: '0.8125rem',
          outline: 'none',
          backgroundColor: disabled ? '#F8FAFC' : '#FFFFFF',
          color: '#0F172A',
          fontFamily: "'Inter', sans-serif",
          transition: 'border-color 150ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 150ms cubic-bezier(0.23, 1, 0.32, 1)',
          ...ring({ focused, filled: !empty, disabled }),
          ...inputStyle,
        }}
        {...rest}
      />

      {empty && placeholder && (
        <div
          style={{
            position: 'absolute',
            left: Icon ? '2.35rem' : '0.85rem',
            right: '0.6rem',
            top: '50%',
            transform: 'translateY(-50%)',
            overflow: 'hidden',
          }}
        >
          <div
            ref={hintRef}
            onScroll={measure}
            /* Focus the input on click, the way a placeholder does. */
            onClick={() => inputRef.current?.focus()}
            className="filter-field-hint"
            style={{
              overflowX: 'auto',
              overflowY: 'hidden',
              whiteSpace: 'nowrap',
              fontSize: '0.8125rem',
              color: '#94A3B8',
              fontFamily: "'Inter', sans-serif",
              cursor: 'text',
            }}
          >
            {placeholder}
          </div>

          {overflow.start && arrow('left')}
          {overflow.end && arrow('right')}
        </div>
      )}

      {clearable && !empty && (
        <button
          type="button"
          onClick={() => { onChange?.(''); inputRef.current?.focus(); }}
          aria-label="Clear this filter"
          style={{
            position: 'absolute', right: '8px', top: '50%',
            transform: 'translateY(-50%)', background: 'none', border: 'none',
            cursor: 'pointer', color: '#94A3B8', padding: '4px', lineHeight: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; }}
        >
          <X size={15} />
        </button>
      )}

      {/* The strip still scrolls — by wheel, by trackpad swipe and by the ‹ ›
          nudges — but draws no scrollbar. A visible bar under a placeholder
          reads as a second border on a field that has no text in it, and the
          nudge arrows already say "there is more this way". */}
      <style>{`
        .filter-field-hint::-webkit-scrollbar { display: none; }
        .filter-field-hint { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
    </div>
  );
}
