// =====================================================================
// THE CANONICAL PERIOD GRID
// =====================================================================
//
// Every lecture in the institute sits in one of a fixed set of 90-minute
// periods starting at 08:30, with a half-hour break after the third. Before
// this, `timetables.start_time` / `end_time` were free-form TIME columns: the
// validator only checked that the end came after the start, so nothing stopped
// a row from being written at 09:07-10:14, and nothing stopped two rows for the
// same section, teacher or room from overlapping.
//
// This module is the single source of truth for that grid. The validator
// rejects off-grid times against it, the service checks double-booking against
// it, the seeder writes rows onto it, and GET /api/timetables/current ships it
// to the portals so the timetable table can render every period as a column -
// including the ones with no class - instead of inferring the columns from
// whatever rows happen to exist.
//
// Changing a period here is not enough on its own: existing rows are pinned to
// the grid by unique indexes, so a change needs a migration that moves the data
// too. See 20260807120000-enforce-timetable-slot-grid.js.

// MySQL TIME columns come back as "HH:mm:ss", so the grid is written in the
// same format and compared as plain strings - no parsing, no timezone.
const SLOTS = [
    { slot_number: 1, start_time: "08:30:00", end_time: "10:00:00" },
    { slot_number: 2, start_time: "10:00:00", end_time: "11:30:00" },
    { slot_number: 3, start_time: "11:30:00", end_time: "13:00:00" },
    { slot_number: 4, start_time: "13:30:00", end_time: "15:00:00" }
];

// The break is rendered by the portals but is not bookable - it deliberately
// has no slot_number, and no timetable row may be written inside it.
const BREAK = {
    start_time: "13:00:00",
    end_time: "13:30:00",
    label: "Break"
};

const SLOT_DURATION_MINUTES = 90;

// "8:30", "08:30" and "08:30:00" all mean the same period. Normalising here
// means the validator accepts what a form would post and the service compares
// against what MySQL returns.
const normalizeTime = (value) => {

    if (value === null || value === undefined) return null;

    const match = String(value).trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);

    if (!match) return null;

    const hours = Number(match[1]);

    if (hours > 23) return null;

    return [
        String(hours).padStart(2, "0"),
        match[2],
        match[3] || "00"
    ].join(":");
};

// The slot a start/end pair names, or null when the pair is off-grid. Both
// halves must match: 08:30-11:30 spans two periods and is not a slot.
const findSlot = (startTime, endTime) => {

    const start = normalizeTime(startTime);
    const end = normalizeTime(endTime);

    if (!start || !end) return null;

    return SLOTS.find((slot) =>
        slot.start_time === start && slot.end_time === end
    ) || null;
};

const findSlotByNumber = (slotNumber) =>
    SLOTS.find((slot) => slot.slot_number === Number(slotNumber)) || null;

// A start time on its own is enough to identify a period, which is what the
// unique indexes key on (section_id, day_of_week, start_time).
const findSlotByStart = (startTime) => {

    const start = normalizeTime(startTime);

    if (!start) return null;

    return SLOTS.find((slot) => slot.start_time === start) || null;
};

// For error messages: "1 (08:30:00-10:00:00), 2 (10:00:00-11:30:00), ..."
const describeSlots = () =>
    SLOTS.map((s) => `${s.slot_number} (${s.start_time}-${s.end_time})`).join(", ");

module.exports = {
    SLOTS,
    BREAK,
    SLOT_DURATION_MINUTES,
    normalizeTime,
    findSlot,
    findSlotByNumber,
    findSlotByStart,
    describeSlots
};
