'use strict';

// Day 10: 3 stored procedures for payment recording, semester result
// publishing, and daily overdue-fee maintenance. All wrap their own
// transaction with an EXIT HANDLER FOR SQLEXCEPTION that rolls back and
// re-signals, so a failed call leaves no partial state and the error still
// reaches the caller.

const SP_RECORD_PAYMENT = `
CREATE PROCEDURE sp_record_payment(
    IN p_student_fee_id INT,
    IN p_amount_paid DECIMAL(12,2),
    IN p_payment_method ENUM('Cash','Bank Transfer','Card','Mobile Wallet'),
    IN p_recorded_by INT
)
BEGIN
    DECLARE v_total_payable DECIMAL(12,2) DEFAULT NULL;
    DECLARE v_due_date DATE;
    DECLARE v_total_paid DECIMAL(12,2);
    DECLARE v_is_late TINYINT(1);
    DECLARE v_new_status VARCHAR(20);
    DECLARE v_payment_id INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT total_payable, due_date
      INTO v_total_payable, v_due_date
      FROM student_fees
     WHERE student_fee_id = p_student_fee_id
     FOR UPDATE;

    IF v_total_payable IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sp_record_payment: student_fee_id not found';
    END IF;

    SET v_is_late = (CURDATE() > v_due_date);

    -- receipt_number is VARCHAR(30) NOT NULL UNIQUE, so it must be set at
    -- insert time, but the real payment_id isn't known until after the
    -- insert. Insert with a short collision-safe placeholder, then rewrite
    -- it to the readable RCPT-YYYY-NNNNNN form once LAST_INSERT_ID() exists.
    INSERT INTO payments (student_fee_id, amount_paid, payment_method, payment_date, is_late, receipt_number, recorded_by)
    VALUES (p_student_fee_id, p_amount_paid, p_payment_method, CURDATE(), v_is_late,
            SUBSTRING(REPLACE(UUID(), '-', ''), 1, 28), p_recorded_by);

    SET v_payment_id = LAST_INSERT_ID();

    UPDATE payments
       SET receipt_number = CONCAT('RCPT-', DATE_FORMAT(CURDATE(), '%Y'), '-', LPAD(v_payment_id, 6, '0'))
     WHERE payment_id = v_payment_id;

    SELECT COALESCE(SUM(amount_paid), 0)
      INTO v_total_paid
      FROM payments
     WHERE student_fee_id = p_student_fee_id;

    SET v_new_status = CASE
        WHEN v_total_paid >= v_total_payable THEN 'Paid'
        WHEN v_total_paid > 0 THEN 'Partially Paid'
        ELSE 'Unpaid'
    END;

    UPDATE student_fees
       SET status = v_new_status
     WHERE student_fee_id = p_student_fee_id;

    COMMIT;

    SELECT v_payment_id AS payment_id, v_new_status AS new_status, v_total_paid AS total_paid,
           (v_total_payable - v_total_paid) AS remaining_balance;
END`;

const SP_PUBLISH_SEMESTER_RESULTS = `
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

    -- Gate: 'Draft' means not yet reviewed by a teacher - that's the only
    -- state that should block publishing. 'Verified' and 'Published' both
    -- count as ready (a mark already 'Published' has already been through
    -- a verify+publish cycle, so it's further along than Draft, not behind
    -- it - it should not block a re-publish).
    SELECT COUNT(*) INTO v_unverified_count
    FROM marks m
    JOIN exams e ON e.exam_id = m.exam_id
    WHERE e.semester_id = p_semester_id AND m.status = 'Draft';

    IF v_unverified_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'sp_publish_semester_results: some marks are still in Draft for this semester';
    END IF;

    -- Temp tables need an explicit PRIMARY KEY - Aiven enforces
    -- sql_require_primary_key, so a plain CREATE TEMPORARY TABLE ... AS
    -- SELECT (no PK) fails on this instance.
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

        -- Semester GPA: credit-hour weighted average of this semester's
        -- per-subject grade points.
        SELECT SUM(grade_point * credit_hours) / SUM(credit_hours), SUM(credit_hours)
          INTO v_gpa, v_semester_credits
          FROM tmp_subject_grade_points
         WHERE student_id = v_student_id;

        -- CGPA: credit-hour weighted average across this semester plus
        -- every prior Published semester for this student.
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

        -- First-ever published semester for this student: no prior history.
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

const SP_MARK_OVERDUE_FEES = `
CREATE PROCEDURE sp_mark_overdue_fees()
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    UPDATE student_fees
       SET status = 'Overdue'
     WHERE due_date < CURDATE()
       AND status NOT IN ('Paid', 'Overdue');

    COMMIT;
END`;

const PROCEDURES = {
  sp_record_payment: SP_RECORD_PAYMENT,
  sp_publish_semester_results: SP_PUBLISH_SEMESTER_RESULTS,
  sp_mark_overdue_fees: SP_MARK_OVERDUE_FEES,
};

module.exports = {
  async up(queryInterface) {
    for (const [name, sql] of Object.entries(PROCEDURES)) {
      await queryInterface.sequelize.query(`DROP PROCEDURE IF EXISTS ${name}`);
      await queryInterface.sequelize.query(sql);
    }
  },
  async down(queryInterface) {
    for (const name of Object.keys(PROCEDURES)) {
      await queryInterface.sequelize.query(`DROP PROCEDURE IF EXISTS ${name}`);
    }
  },
};
