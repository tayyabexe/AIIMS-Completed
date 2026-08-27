/*
 * Room types, and the one rule that relates a room to a class.
 *
 * `classrooms.room_type` says what a space is; `course_offerings
 * .required_room_type` says what a class needs. Before these columns existed,
 * "Lab 1" and "401" were both just strings and nothing could refuse to put a
 * practical in a lecture theatre - an admin who knew the estate could avoid
 * it, but the system had no rule to check.
 *
 * Kept in its own module rather than inlined in the scheduler because three
 * places have to agree on the list: the migration's ENUM, the admin form's
 * dropdown, and the matching rule below.
 */

// The order here is the order the admin UI should offer them in - commonest
// first, not alphabetical.
const ROOM_TYPES = ["Lecture", "Lab", "Auditorium", "Seminar"];

const ROOM_TYPE_LABELS = {
    Lecture: "Lecture room",
    Lab: "Laboratory",
    Auditorium: "Auditorium",
    Seminar: "Seminar room"
};

const isRoomType = (value) => ROOM_TYPES.includes(value);

/*
 * Does `roomType` satisfy `requirement`?
 *
 * A NULL requirement means the class does not care, which is true of most
 * subjects and is the honest default for every row that predates this. It is
 * deliberately not an 'Any' enum member: 'Any' would look like a decision
 * somebody made, and would be indistinguishable from a subject nobody has got
 * round to classifying. NULL is greppable; 'Any' is not.
 *
 * Otherwise the match is exact. Substitution rules ("a seminar room will do at
 * a pinch for a lecture") are deliberately absent - they vary by institution
 * and encoding a guess here would silently place classes in rooms the
 * timetabler would not have chosen.
 */
const satisfiesRoomRequirement = (roomType, requirement) => {
    if (requirement === null || requirement === undefined) return true;

    return roomType === requirement;
};

module.exports = {
    ROOM_TYPES,
    ROOM_TYPE_LABELS,
    isRoomType,
    satisfiesRoomRequirement
};
