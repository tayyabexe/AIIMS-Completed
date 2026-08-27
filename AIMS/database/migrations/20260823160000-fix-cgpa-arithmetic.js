'use strict';

/*
 * TASK 9 — the CGPA was computed wrongly, in three separate ways.
 *
 * `sp_publish_semester_results` is the only thing in the system that writes a
 * GPA or a CGPA. Its semester GPA was already right: credit-hour weighted,
 * against the institute's own `grades` scale. The CGPA carried across semesters
 * was not.
 *
 * ---------------------------------------------------------------------------
 * 1. RE-PUBLISHING A SEMESTER FOLDED IT INTO ITS OWN CGPA
 * ---------------------------------------------------------------------------
 * The running total read every Published row in `results` for the student and
 * did not exclude the semester being published. On a first publish there is no
 * such row and the arithmetic is right. On the SECOND publish — which is the
 * whole point of the upsert, and what happens whenever a mark is corrected —
 * the row about to be overwritten was summed in as though it were a previous
 * semester, and then the new figure was added on top of it. One semester,
 * counted twice, at two different values.
 *
 * It went unnoticed because a re-publish with an unchanged GPA produces the
 * same answer: (4.0*3 + 4.0*3) / (3 + 3) is still 4.0. It only diverges once
 * the mark actually changes, which is the one case anybody re-publishes for.
 *
 * ---------------------------------------------------------------------------
 * 2. TWO DIFFERENT DEFINITIONS OF "CREDITS" IN ONE FRACTION
 * ---------------------------------------------------------------------------
 * Prior semesters were weighted by credits summed from `enrollments`; the
 * current semester was weighted by credits summed from the subjects that
 * happened to earn a grade point. Those are not the same number, so the two
 * halves of the average were measured on different scales — and the enrollment
 * side counted DROPPED registrations, so dropping a course silently increased
 * the weight of the semester it was dropped from.
 *
 * Both sides now use the same rule, the one agreed for this task: credits of
 * NOT-DROPPED enrollments, for every semester including the current one.
 *
 * ---------------------------------------------------------------------------
 * 3. A SUBJECT OUTSIDE EVERY GRADE BAND VANISHED
 * ---------------------------------------------------------------------------
 * Grade points came from `JOIN grades g ON percentage BETWEEN g.min AND g.max`.
 * An inner join drops what it cannot match, so a subject scoring outside every
 * band — 100.4% from a bonus mark, or a band gap in a hand-edited scale — left
 * the GPA quietly, taking its credits with it. The student's GPA was then an
 * average of the subjects that happened to fit, presented as an average of all
 * of them.
 *
 * The percentage is now clamped into 0..100 before the join, so a mark above
 * the maximum grades as the top band instead of disappearing. A subject that
 * still fails to match is reported by the procedure rather than skipped
 * silently — see the SIGNAL below.
 *
 * ---------------------------------------------------------------------------
 * The semester GPA formula itself is unchanged. This migration is arithmetic
 * corrections to the CGPA and the credit basis, not a new grading policy.
 */

const DROP = 'DROP PROCEDURE IF EXISTS sp_publish_semester_results';

const CREATE_FIXED = `
CREATE PROCEDURE sp_publish_semester_results(IN p_semester_id INT)
BEGIN
    DECLARE v_unverified_count INT DEFAULT 0;
    DECLARE v_ungraded_count INT DEFAULT 0;
    DECLARE v_done INT DEFAULT FALSE;
    DECLARE v_student_id INT;
    DECLARE v_gpa DECIMAL(3,2);
    DECLARE v_cgpa DECIMAL(3,2);
    DECLARE v_semester_credits DECIMAL(10,2);
    DECLARE v_prior_points DECIMAL(14,4);
    DECLARE v_prior_credits DECIMAL(14,4);

    DECLARE student_cur CURSOR FOR
        SELECT DISTINCT m.student_id
        FROM marks m
        JOIN exams e ON e.exam_id = m.exam_id
        WHERE e.semester_id = p_semester_id;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- A Draft mark is one the teacher has not submitted. A GPA computed from
    -- half an entry is worse than no GPA at all.
    SELECT COUNT(*) INTO v_unverified_count
    FROM marks m
    JOIN exams e ON e.exam_id = m.exam_id
    WHERE e.semester_id = p_semester_id AND m.status = 'Draft';

    IF v_unverified_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'sp_publish_semester_results: some marks are still in Draft for this semester';
    END IF;

    -- ---- per subject: the percentage the student scored -------------------
    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grades;
    CREATE TEMPORARY TABLE tmp_subject_grades (
        student_id INT NOT NULL,
        subject_id INT NOT NULL,
        credit_hours INT NOT NULL,
        subject_percentage DECIMAL(6,2) NOT NULL,
        PRIMARY KEY (student_id, subject_id)
    );
    INSERT INTO tmp_subject_grades (student_id, subject_id, credit_hours, subject_percentage)
    SELECT
        m.student_id,
        e.subject_id,
        sub.credit_hours,
        /*
         * Clamped into the range the grading scale actually covers. A subject
         * scoring 100.4% (a bonus mark, or a total_marks that was lowered after
         * the fact) matched no band and used to fall out of the GPA entirely,
         * silently taking its credit hours with it.
         */
        LEAST(100, GREATEST(0, SUM(m.obtained_marks) / NULLIF(SUM(e.total_marks), 0) * 100))
    FROM marks m
    JOIN exams e      ON e.exam_id = m.exam_id
    JOIN subjects sub ON sub.subject_id = e.subject_id
    WHERE e.semester_id = p_semester_id
      AND e.total_marks > 0
    GROUP BY m.student_id, e.subject_id, sub.credit_hours
    HAVING SUM(e.total_marks) > 0;

    -- ---- per subject: the grade point that percentage earns ---------------
    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grade_points;
    CREATE TEMPORARY TABLE tmp_subject_grade_points (
        student_id INT NOT NULL,
        subject_id INT NOT NULL,
        credit_hours INT NOT NULL,
        grade_point DECIMAL(3,2) NOT NULL,
        PRIMARY KEY (student_id, subject_id)
    );
    INSERT INTO tmp_subject_grade_points (student_id, subject_id, credit_hours, grade_point)
    SELECT
        tsg.student_id,
        tsg.subject_id,
        tsg.credit_hours,
        g.grade_point
    FROM tmp_subject_grades tsg
    JOIN grades g ON tsg.subject_percentage BETWEEN g.min_percentage AND g.max_percentage;

    /*
     * If the clamp above was not enough, the grading scale itself has a hole in
     * it and some subject scored into the gap. Refusing is right: publishing
     * would write a GPA that silently excludes that subject, and nobody looking
     * at the number afterwards could tell.
     */
    SELECT COUNT(*) INTO v_ungraded_count
    FROM tmp_subject_grades tsg
    LEFT JOIN tmp_subject_grade_points tgp
           ON tgp.student_id = tsg.student_id AND tgp.subject_id = tsg.subject_id
    WHERE tgp.student_id IS NULL;

    IF v_ungraded_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'sp_publish_semester_results: the grading scale has a gap - some subject percentages match no grade band';
    END IF;

    /*
     * ---- credits, defined ONCE ----------------------------------------
     * Credit hours of the student's not-Dropped enrollments, per semester.
     * Both the current semester's weight and every prior semester's weight are
     * read from this one table, so the two halves of the CGPA are measured the
     * same way. Previously they were not, and dropped registrations inflated
     * the prior-semester side.
     */
    DROP TEMPORARY TABLE IF EXISTS tmp_semester_credits;
    CREATE TEMPORARY TABLE tmp_semester_credits (
        student_id INT NOT NULL,
        semester_id INT NOT NULL,
        total_credits DECIMAL(10,2) NOT NULL,
        PRIMARY KEY (student_id, semester_id)
    );
    INSERT INTO tmp_semester_credits (student_id, semester_id, total_credits)
    SELECT en.student_id, en.semester_id, SUM(s.credit_hours)
    FROM enrollments en
    JOIN subjects s ON s.subject_id = en.subject_id
    WHERE en.status <> 'Dropped'
    GROUP BY en.student_id, en.semester_id;

    OPEN student_cur;

    read_loop: LOOP
        FETCH student_cur INTO v_student_id;
        IF v_done THEN
            LEAVE read_loop;
        END IF;

        -- The semester's own GPA: credit-hour weighted over its graded
        -- subjects. Unchanged from the original.
        SELECT SUM(grade_point * credit_hours) / NULLIF(SUM(credit_hours), 0)
          INTO v_gpa
          FROM tmp_subject_grade_points
         WHERE student_id = v_student_id;

        /*
         * The semester's weight in the CGPA, from the enrollment roster rather
         * than from whichever subjects happened to be graded — so a student
         * who is registered for 15 credits and sat 12 of them is weighted as
         * the 15-credit semester it is.
         *
         * Falls back to the graded credits when the student has no enrollment
         * rows at all, which is the only case where the roster cannot answer.
         */
        SELECT total_credits INTO v_semester_credits
          FROM tmp_semester_credits
         WHERE student_id = v_student_id AND semester_id = p_semester_id;

        IF v_semester_credits IS NULL OR v_semester_credits = 0 THEN
            SELECT SUM(credit_hours) INTO v_semester_credits
              FROM tmp_subject_grade_points
             WHERE student_id = v_student_id;
        END IF;

        /*
         * Every OTHER published semester — the exclusion that was missing.
         *
         * "r.semester_id <> p_semester_id" is the fix for the double count: on
         * a re-publish the row being overwritten is no longer summed in as a
         * prior semester before the new value is added on top of it.
         */
        SELECT SUM(r.gpa * sc.total_credits), SUM(sc.total_credits)
          INTO v_prior_points, v_prior_credits
          FROM results r
          JOIN tmp_semester_credits sc
            ON sc.student_id = r.student_id AND sc.semester_id = r.semester_id
         WHERE r.student_id = v_student_id
           AND r.status = 'Published'
           AND r.semester_id <> p_semester_id;

        SET v_prior_points  = COALESCE(v_prior_points, 0);
        SET v_prior_credits = COALESCE(v_prior_credits, 0);

        SET v_cgpa = (v_prior_points + (v_gpa * COALESCE(v_semester_credits, 0)))
                     / NULLIF(v_prior_credits + COALESCE(v_semester_credits, 0), 0);

        -- A first semester with no prior history: the CGPA is the GPA.
        IF v_cgpa IS NULL THEN
            SET v_cgpa = v_gpa;
        END IF;

        INSERT INTO results (student_id, semester_id, gpa, cgpa, published_at, status)
        VALUES (v_student_id, p_semester_id, v_gpa, v_cgpa, NOW(), 'Published')
        ON DUPLICATE KEY UPDATE
            gpa = v_gpa, cgpa = v_cgpa, published_at = NOW(), status = 'Published';

    END LOOP;

    CLOSE student_cur;

    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grades;
    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grade_points;
    DROP TEMPORARY TABLE IF EXISTS tmp_semester_credits;

    COMMIT;
END`;

/*
 * The procedure exactly as it stood before this migration, so `down` restores
 * the old behaviour rather than dropping the procedure and leaving publishing
 * broken. Reproduced from SHOW CREATE PROCEDURE on the live database.
 */
const CREATE_ORIGINAL = `
CREATE PROCEDURE sp_publish_semester_results(IN p_semester_id INT)
BEGIN
    DECLARE v_unverified_count INT DEFAULT 0;
    DECLARE v_done INT DEFAULT FALSE;
    DECLARE v_student_id INT;
    DECLARE v_gpa DECIMAL(3,2);
    DECLARE v_cgpa DECIMAL(3,2);
    DECLARE v_semester_credits DECIMAL(10,2);

    DECLARE student_cur CURSOR FOR
        SELECT DISTINCT m.student_id
        FROM marks m
        JOIN exams e ON e.exam_id = m.exam_id
        WHERE e.semester_id = p_semester_id;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT COUNT(*) INTO v_unverified_count
    FROM marks m
    JOIN exams e ON e.exam_id = m.exam_id
    WHERE e.semester_id = p_semester_id AND m.status = 'Draft';

    IF v_unverified_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'sp_publish_semester_results: some marks are still in Draft for this semester';
    END IF;

    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grades;
    CREATE TEMPORARY TABLE tmp_subject_grades (
        student_id INT NOT NULL,
        subject_id INT NOT NULL,
        credit_hours INT NOT NULL,
        subject_percentage DECIMAL(6,2) NOT NULL,
        PRIMARY KEY (student_id, subject_id)
    );
    INSERT INTO tmp_subject_grades (student_id, subject_id, credit_hours, subject_percentage)
    SELECT
        m.student_id,
        e.subject_id,
        sub.credit_hours,
        SUM(m.obtained_marks) / SUM(e.total_marks) * 100
    FROM marks m
    JOIN exams e      ON e.exam_id = m.exam_id
    JOIN subjects sub ON sub.subject_id = e.subject_id
    WHERE e.semester_id = p_semester_id
    GROUP BY m.student_id, e.subject_id, sub.credit_hours;

    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grade_points;
    CREATE TEMPORARY TABLE tmp_subject_grade_points (
        student_id INT NOT NULL,
        subject_id INT NOT NULL,
        credit_hours INT NOT NULL,
        grade_point DECIMAL(3,2) NOT NULL,
        PRIMARY KEY (student_id, subject_id)
    );
    INSERT INTO tmp_subject_grade_points (student_id, subject_id, credit_hours, grade_point)
    SELECT
        tsg.student_id,
        tsg.subject_id,
        tsg.credit_hours,
        g.grade_point
    FROM tmp_subject_grades tsg
    JOIN grades g ON tsg.subject_percentage BETWEEN g.min_percentage AND g.max_percentage;

    OPEN student_cur;

    read_loop: LOOP
        FETCH student_cur INTO v_student_id;
        IF v_done THEN
            LEAVE read_loop;
        END IF;

        SELECT SUM(grade_point * credit_hours) / SUM(credit_hours), SUM(credit_hours)
          INTO v_gpa, v_semester_credits
          FROM tmp_subject_grade_points
         WHERE student_id = v_student_id;

        SELECT
            (SUM(r.gpa * sc.total_credits) + (v_gpa * v_semester_credits))
            / (SUM(sc.total_credits) + v_semester_credits)
          INTO v_cgpa
          FROM results r
          JOIN (
              SELECT en.student_id, en.semester_id, SUM(s.credit_hours) AS total_credits
              FROM enrollments en
              JOIN subjects s ON s.subject_id = en.subject_id
              GROUP BY en.student_id, en.semester_id
          ) sc ON sc.student_id = r.student_id AND sc.semester_id = r.semester_id
         WHERE r.student_id = v_student_id AND r.status = 'Published';

        IF v_cgpa IS NULL THEN
            SET v_cgpa = v_gpa;
        END IF;

        INSERT INTO results (student_id, semester_id, gpa, cgpa, published_at, status)
        VALUES (v_student_id, p_semester_id, v_gpa, v_cgpa, NOW(), 'Published')
        ON DUPLICATE KEY UPDATE
            gpa = v_gpa, cgpa = v_cgpa, published_at = NOW(), status = 'Published';

    END LOOP;

    CLOSE student_cur;

    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grades;
    DROP TEMPORARY TABLE IF EXISTS tmp_subject_grade_points;

    COMMIT;
END`;

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(DROP);
        await queryInterface.sequelize.query(CREATE_FIXED);
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(DROP);
        await queryInterface.sequelize.query(CREATE_ORIGINAL);
    }
};
