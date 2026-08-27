import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, X } from 'lucide-react';
import { searchModules } from '../../api/searchCatalog';
import './PortalSearch.css';

/**
 * The portal search bar and its results popup.
 *
 * Two kinds of result are shown:
 *  - "Jump to a module" — navigation targets the signed-in role is allowed to
 *    open, taken from searchCatalog so a portal can never surface another
 *    portal's screens.
 *  - Record groups — supplied by the host portal through `recordGroups`, which
 *    is how each portal searches its own data by whatever attributes make
 *    sense there (roll number, subject code, challan number, and so on).
 *
 * Keyboard: ↑/↓ move, Enter opens, Escape closes.
 *
 * Props:
 *  - portal: 'student' | 'faculty' | 'admin'
 *  - recordGroups: either (query) => groups, for a portal that filters data it
 *    has already loaded, or an already-built groups array, for a portal whose
 *    results come from the server (admin, via GET /api/search).
 *  - onNavigate: (module) => void — how this portal opens a module.
 *  - onQueryChange: (trimmedQuery) => void — lets a server-backed portal drive
 *    its own fetch off the box's current text.
 *  - searching / searchError — surfaced in the popup so a server-backed search
 *    shows progress and failures instead of a bare "No matches".
 */
export default function PortalSearch({
  portal,
  recordGroups,
  onNavigate,
  onQueryChange,
  searching = false,
  searchError = null,
  // Called the first time the box is focused. Portals that load their search
  // directory lazily (admin) use it to kick that fetch off.
  onActivate,
  placeholder = 'Search or jump to a module...',
  className = '',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);

  const trimmed = query.trim();

  const moduleMatches = useMemo(
    () => (trimmed ? searchModules(portal, trimmed) : []),
    [portal, trimmed],
  );

  // Record lookup is delegated to the portal; guard it so one portal's data
  // problem cannot take the whole search bar down.
  const groups = useMemo(() => {
    if (!trimmed) return [];

    // Server-backed portal: the groups are already resolved for this query.
    if (Array.isArray(recordGroups)) {
      return recordGroups.filter((g) => g && g.items && g.items.length);
    }

    if (typeof recordGroups !== 'function') return [];
    try {
      return (recordGroups(trimmed) || []).filter((g) => g && g.items && g.items.length);
    } catch {
      return [];
    }
  }, [recordGroups, trimmed]);

  // Report the current text so a server-backed host can fetch for it.
  useEffect(() => {
    onQueryChange?.(trimmed);
  }, [trimmed, onQueryChange]);

  // One flat list so arrow keys can walk modules and records together.
  const flat = useMemo(() => {
    const rows = moduleMatches.map((m) => ({
      key: `module:${m.id}`,
      kind: 'module',
      title: m.label,
      subtitle: 'Module',
      run: () => onNavigate(m),
    }));

    groups.forEach((g) => {
      g.items.forEach((item) => {
        rows.push({
          key: `record:${g.id}:${item.id}`,
          kind: 'record',
          groupId: g.id,
          title: item.title,
          subtitle: item.subtitle,
          meta: item.meta,
          run: item.onSelect,
        });
      });
    });

    return rows;
  }, [moduleMatches, groups, onNavigate]);

  useEffect(() => setActiveIndex(0), [trimmed]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const runAt = useCallback(
    (index) => {
      const row = flat[index];
      if (!row || typeof row.run !== 'function') return;
      row.run();
      setOpen(false);
      setQuery('');
    },
    [flat],
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!flat.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(activeIndex);
    }
  };

  // Index of the first row of each record group, for rendering headings.
  const moduleCount = moduleMatches.length;
  const showPopup = open && trimmed.length > 0;
  const hasResults = flat.length > 0;

  let cursor = moduleCount;

  return (
    <div className={`aims-search ${className}`} ref={ref}>
      <div className="aims-search-field">
        <Search size={16} className="aims-search-icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            onActivate?.();
          }}
          onKeyDown={onKeyDown}
          aria-label="Search"
          aria-expanded={showPopup}
          aria-controls="aims-search-results"
          role="combobox"
        />
        {query && (
          <button
            type="button"
            className="aims-search-clear"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showPopup && (
        <div className="aims-search-popup" id="aims-search-results" role="listbox">
          {/* "No matches" must not be claimed while the request is still out,
              or a slow search reads as an empty database. */}
          {searchError ? (
            <div className="aims-search-empty error">
              Search failed: {searchError}
            </div>
          ) : searching && !hasResults ? (
            <div className="aims-search-empty">
              <span className="aims-search-spinner" />
              Searching…
            </div>
          ) : !hasResults ? (
            <div className="aims-search-empty">
              No matches for “{trimmed}”.
            </div>
          ) : null}

          {moduleCount > 0 && (
            <>
              <div className="aims-search-heading">Jump to a module</div>
              {moduleMatches.map((m, i) => (
                <button
                  type="button"
                  key={m.id}
                  role="option"
                  aria-selected={activeIndex === i}
                  className={`aims-search-row${activeIndex === i ? ' active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => runAt(i)}
                >
                  <span className="aims-search-row-title">{m.label}</span>
                  <CornerDownLeft size={13} className="aims-search-row-enter" />
                </button>
              ))}
            </>
          )}

          {groups.map((g) => {
            const start = cursor;
            cursor += g.items.length;
            return (
              <div key={g.id}>
                <div className="aims-search-heading">{g.label}</div>
                {g.items.map((item, i) => {
                  const index = start + i;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      role="option"
                      aria-selected={activeIndex === index}
                      className={`aims-search-row${activeIndex === index ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runAt(index)}
                    >
                      <span className="aims-search-row-body">
                        <span className="aims-search-row-title">{item.title}</span>
                        {item.subtitle && (
                          <span className="aims-search-row-sub">{item.subtitle}</span>
                        )}
                      </span>
                      {item.meta && <span className="aims-search-row-meta">{item.meta}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
