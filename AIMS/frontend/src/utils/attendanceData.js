/*
 * Presentation helpers for the student Attendance screen.
 *
 * This module used to BE the attendance data: six invented courses (CS-601
 * "Artificial Intelligence" 33/36, CS-602 25/30, ...), a five-point monthly
 * trend rising 82 -> 87, and a fixed July 2024 calendar whose statuses came
 * from a `dayStatusOverrides` object marking the 3rd absent and the 5th late.
 * Every student saw the same figures no matter what the database held.
 *
 * The real figures are now derived from GET /api/attendance/student/:id in
 * api/studentData.js. What is left here is arithmetic with no data in it: the
 * shape of a month grid and the labels drawn beside it.
 */

export { ATTENDANCE_MIN_PCT as MIN_REQUIRED_PCT, classesNeededForThreshold }
  from '../api/studentData';

export const WEEKDAY_HEADS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const monthLabel = (year, month) => `${MONTH_LONG[month]} ${year}`;

/**
 * A Sunday-first grid for one month: leading and trailing nulls pad the first
 * and last weeks so the cells line up under their weekday headings.
 *
 * The month is built from the calendar rather than hardcoded, so February's 29
 * days in 2024 and a month starting mid-week both come out right — the old
 * fixed 5x7 July grid was correct for exactly one month of one year.
 */
export const buildMonthGrid = (year, month) => {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
};

/** 'YYYY-MM-DD' for a day of the grid, to look the day up in the row index. */
export const isoDate = (year, month, day) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** 'Present' -> 'present', so a status maps straight onto its CSS class. */
export const statusClass = (status) => (status ? status.toLowerCase() : null);

export const formatDate = (value) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : null;
