/*
 * Date and time formatting for the screens that show a stream of timestamped
 * records — the dashboard activity feed and the audit trail.
 *
 * These live together because the two screens must agree: the feed is a
 * twelve-row window onto the same rows the audit page lists in full, and a
 * timestamp that reads "14:32" on one and "2:32 PM" on the other makes them
 * look like different data.
 *
 * Everything here is defensive about its input. A timestamp arrives as whatever
 * MySQL and the JSON encoder made of it, and a feed must not blank out because
 * one row's `published_at` was null.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const parse = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * "Just now" / "20 min ago" / "3 days ago" / "12 Mar 2024".
 *
 * Relative while that still means something, absolute once it does not — "94
 * days ago" is a number nobody converts into a date in their head.
 */
export const relativeTime = (value) => {
  const then = parse(value);
  if (!then) return '';

  const diff = Date.now() - then.getTime();

  // A clock that is a little ahead of the server should not produce
  // "-2 min ago"; anything in the future reads as now.
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "14:32" — the clock time, for the time column of a feed. */
export const timeOfDay = (value) => {
  const date = parse(value);
  if (!date) return '—';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/**
 * The heading a day's worth of rows sits under: "Today", "Yesterday", or the
 * date itself.
 *
 * Compared by calendar day rather than by elapsed hours — 23:50 last night is
 * "Yesterday" at 00:10, and a 24-hour subtraction would call it "Today".
 */
export const dayLabel = (value) => {
  const date = parse(value);
  if (!date) return 'Undated';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  return date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  });
};

/** "13 Aug 2026, 14:32" — a full stamp, for a detail panel or a tooltip. */
export const fullTimestamp = (value) => {
  const date = parse(value);
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};
