-- =====================================================================
-- AIMS - Reference data
-- Generated from the LIVE database (aims_db) on 2026-08-27T15:32:02.573Z
--
-- Run this AFTER schema.sql and constraints.sql.
--
-- This is the fixed data an AIMS database needs before anybody can sign in:
-- the role table the source hardcodes ids against, the permission grants, the
-- grading scale the GPA views read, and the migration ledger.
--
-- It contains NO personal data. No students, staff, parents, marks, fees or
-- attendance - those are created through the application.
--
-- Do not hand-edit; re-run `node scripts/generate_reference_data.js` instead.
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------- roles (8 rows)
DELETE FROM `roles`;
INSERT INTO `roles` (`role_id`, `role_name`, `description`) VALUES
  (1, 'Super Admin', 'Full access across the entire system'),
  (2, 'Admin', 'General administrative operations'),
  (3, 'Teacher', 'Academic operations and marking'),
  (4, 'Student', 'Portal access and course view'),
  (5, 'Parent', 'View dependent progress and fees'),
  (6, 'HR', 'Manages employee records and payroll'),
  (7, 'Accountant', 'Manages fees, payments, and financial records'),
  (8, 'Library Staff', 'Manages book inventory and issues');

-- ------------------------------------------------- permissions (18 rows)
DELETE FROM `permissions`;
INSERT INTO `permissions` (`permission_id`, `permission_name`, `module`) VALUES
  (1, 'manage_users', 'Identity'),
  (2, 'manage_students', 'Academic'),
  (3, 'manage_teachers', 'HR'),
  (4, 'manage_departments', 'Academic'),
  (5, 'manage_courses', 'Academic'),
  (6, 'manage_timetable', 'Academic'),
  (7, 'mark_attendance', 'Academics'),
  (8, 'enter_marks', 'Exams'),
  (9, 'manage_fees', 'Finance'),
  (10, 'view_fee_vouchers', 'Finance'),
  (11, 'manage_payroll', 'HR'),
  (12, 'manage_library', 'Library'),
  (13, 'manage_ai_predictions', 'AI'),
  (14, 'view_reports', 'Reporting'),
  (15, 'manage_notifications', 'Communication'),
  (16, 'view_attendance', 'Academic'),
  (17, 'view_grades', 'Exam'),
  (18, 'issue_books', 'Library');

-- ------------------------------------------------- role_permissions (35 rows)
DELETE FROM `role_permissions`;
INSERT INTO `role_permissions` (`role_id`, `permission_id`) VALUES
  (1, 1),
  (2, 1),
  (1, 2),
  (1, 3),
  (1, 4),
  (1, 5),
  (1, 6),
  (1, 7),
  (2, 7),
  (3, 7),
  (1, 8),
  (2, 8),
  (3, 8),
  (1, 9),
  (2, 9),
  (7, 9),
  (1, 10),
  (1, 11),
  (1, 12),
  (1, 13),
  (1, 14),
  (1, 15),
  (1, 16),
  (2, 16),
  (3, 16),
  (4, 16),
  (5, 16),
  (1, 17),
  (2, 17),
  (3, 17),
  (4, 17),
  (5, 17),
  (1, 18),
  (2, 18),
  (8, 18);

-- ------------------------------------------------- grades (5 rows)
DELETE FROM `grades`;
INSERT INTO `grades` (`grade_id`, `grade_letter`, `min_percentage`, `max_percentage`, `grade_point`) VALUES
  (1, 'A', '85.00', '100.00', '4.00'),
  (2, 'B', '70.00', '84.99', '3.00'),
  (3, 'C', '60.00', '69.99', '2.00'),
  (4, 'D', '50.00', '59.99', '1.00'),
  (5, 'F', '0.00', '49.99', '0.00');

-- =====================================================================
-- Migration ledger (93 migrations)
--
-- schema.sql already contains everything these migrations produce, so they
-- must NOT be run again. Stamping them here makes
-- `npx sequelize-cli db:migrate:status` read all-`up`, and makes the next
-- new migration the only one that runs.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `SequelizeMeta` (
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM `SequelizeMeta`;
INSERT INTO `SequelizeMeta` (`name`) VALUES
  ('20260721090001-create-roles.js'),
  ('20260721090002-create-permissions.js'),
  ('20260721090003-create-role-permissions.js'),
  ('20260721090004-create-users.js'),
  ('20260721090005-create-departments.js'),
  ('20260721090006-create-programs.js'),
  ('20260721090007-create-batches.js'),
  ('20260721090008-create-sections.js'),
  ('20260721090009-create-students.js'),
  ('20260722100001-create-semesters.js'),
  ('20260722100002-create-subjects.js'),
  ('20260722100003-create-enrollments.js'),
  ('20260722110001-optimize-relationship-indexes.js'),
  ('20260722120001-create-student-documents.js'),
  ('20260722130002-add-is-late-to-payments.js'),
  ('20260722130003-add-gender-and-current-semester-to-students.js'),
  ('20260722130004-extend-student-documents-doctype.js'),
  ('20260723140001-create-employees.js'),
  ('20260723140002-create-teachers.js'),
  ('20260723140003-create-classrooms.js'),
  ('20260723140004-create-timetables.js'),
  ('20260723140005-create-attendance.js'),
  ('20260723150001-add-head-employee-fk-to-departments.js'),
  ('20260723155001-create-parents.js'),
  ('20260723160001-optimize-is-deleted-indexes-round2.js'),
  ('20260723160002-add-timetable-attendance-composite-indexes.js'),
  ('20260724100001-create-grades.js'),
  ('20260724100002-create-student-guardians.js'),
  ('20260724100003-create-teacher-subjects.js'),
  ('20260724100004-create-teacher-attendance.js'),
  ('20260724100005-create-payroll.js'),
  ('20260724100006-create-employee-documents.js'),
  ('20260724100007-create-performance-evaluations.js'),
  ('20260724100008-create-leave-requests.js'),
  ('20260724100009-create-exams.js'),
  ('20260724100010-create-marks.js'),
  ('20260724100011-create-results.js'),
  ('20260724100012-create-fee-structures.js'),
  ('20260724100013-create-student-fees.js'),
  ('20260724100014-create-scholarships.js'),
  ('20260724100015-create-meeting-requests.js'),
  ('20260724100016-create-announcements.js'),
  ('20260724100017-create-notifications.js'),
  ('20260724100018-create-books.js'),
  ('20260724100019-create-book-issues.js'),
  ('20260724100020-create-prediction-models.js'),
  ('20260724100021-create-ai-predictions.js'),
  ('20260724100022-create-prediction-history.js'),
  ('20260724100023-create-reports.js'),
  ('20260724100024-create-dashboard-widgets.js'),
  ('20260724100025-create-audit-logs.js'),
  ('20260724100026-create-payments.js'),
  ('20260729100001-create-reporting-views.js'),
  ('20260729100002-add-timetable-section-schedule-index.js'),
  ('20260729100003-create-stored-procedures.js'),
  ('20260729110001-create-additional-reporting-views.js'),
  ('20260729110002-create-book-fine-procedure.js'),
  ('20260806120000-add-student-address-nationality-blood-group.js'),
  ('20260807120000-enforce-timetable-slot-grid.js'),
  ('20260808090000-consolidate-fee-module.js'),
  ('20260808140000-create-user-preferences.js'),
  ('20260812090000-add-password-provisioning-flags.js'),
  ('20260812160000-add-payment-verification-trail.js'),
  ('20260815090000-store-media-as-binary.js'),
  ('20260816090000-extend-notifications.js'),
  ('20260817090000-rebuild-reporting-views.js'),
  ('20260817093000-create-assistant-views.js'),
  ('20260817100000-create-assistant-tables.js'),
  ('20260820090000-add-user-full-name.js'),
  ('20260820120000-extend-assistant-response-type.js'),
  ('20260820140000-create-saved-analytics.js'),
  ('20260820160000-reset-card-heights-to-pixels.js'),
  ('20260820170000-add-card-user-sized.js'),
  ('20260821090000-add-card-breakpoint.js'),
  ('20260821140000-add-faculty-insights-surface.js'),
  ('20260821170000-add-faculty-dashboard-surface.js'),
  ('20260821180000-retire-email-verified.js'),
  ('20260822090000-create-academic-terms.js'),
  ('20260822091000-add-room-types.js'),
  ('20260822092000-create-course-offerings.js'),
  ('20260822093000-link-timetables-and-enrollments-to-offerings.js'),
  ('20260822094000-scope-timetable-uniqueness-to-term.js'),
  ('20260822110000-reconcile-section-capacity.js'),
  ('20260822120000-one-rule-for-sessions-per-week.js'),
  ('20260822130000-enforce-single-active-term.js'),
  ('20260822140000-qualification-is-not-batch-scoped.js'),
  ('20260822160000-move-avatars-into-the-database.js'),
  ('20260823120000-add-faculty-attendance-surface.js'),
  ('20260823140000-lock-accounts-after-failed-logins.js'),
  ('20260823150000-students-land-in-their-real-semester.js'),
  ('20260823160000-fix-cgpa-arithmetic.js'),
  ('20260824100000-enrollment-semester-follows-its-subject.js'),
  ('20260827130000-comment-unused-permission-tables.js');

SET FOREIGN_KEY_CHECKS = 1;
