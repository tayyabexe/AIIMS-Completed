-- =====================================================================
-- AIMS - Database Schema (structure only)
-- Generated from the LIVE database (aims_db) on 2026-08-27T15:31:42.526Z
-- Source of truth: the deployed schema, not the migration history.
-- Do not hand-edit; re-run `node scripts/generate_schema_from_live.js` instead.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABLES WITH NO APPLICATION CODE BEHIND THEM
--
-- These are part of the schema but are not read or written by any
-- route, controller or service. A table here does NOT indicate a
-- working feature. See docs/GAPS_AND_LIMITATIONS.md section 3.
--
--   books, book_issues
--       library circulation; sp_calculate_book_fines is written for it and never called
--   payroll
--       salary processing
--   employee_documents
--       staff document storage
--   leave_requests
--       staff leave
--   performance_evaluations
--       staff appraisal
--   teacher_attendance
--       staff attendance
--   scholarships
--       fee concessions; referenced only by a delete-guard count
--   meeting_requests
--       parent-teacher meetings
--   ai_predictions, prediction_models, prediction_history
--       an ML feature that was never wired up
--   dashboard_widgets
--       configurable dashboards; the live pinned-card system uses analytics_dashboard_cards instead
--
-- Two further tables, `permissions` and `role_permissions`, ARE
-- populated but are never consulted: authorisation compares role ids
-- only. Each carries a table COMMENT saying so.
-- ---------------------------------------------------------------------

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------- academic_terms
DROP TABLE IF EXISTS `academic_terms`;
CREATE TABLE `academic_terms` (
  `term_id` int NOT NULL AUTO_INCREMENT,
  `term_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `term_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('Planned','Active','Closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Planned',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `active_flag` tinyint GENERATED ALWAYS AS ((case when (`status` = _utf8mb4'Active') then 1 else NULL end)) VIRTUAL,
  PRIMARY KEY (`term_id`),
  UNIQUE KEY `term_code` (`term_code`),
  UNIQUE KEY `uq_one_active_term` (`active_flag`),
  KEY `idx_academic_terms_status` (`status`,`is_deleted`),
  KEY `idx_academic_terms_start` (`start_date`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- ai_predictions
DROP TABLE IF EXISTS `ai_predictions`;
CREATE TABLE `ai_predictions` (
  `prediction_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `model_id` int NOT NULL,
  `prediction_type` enum('Performance','Fee Default','Attendance Risk') COLLATE utf8mb4_unicode_ci NOT NULL,
  `predicted_value` decimal(6,2) DEFAULT NULL,
  `risk_level` enum('Low','Medium','High','Critical') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confidence_score` decimal(5,2) DEFAULT NULL,
  `generated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`prediction_id`),
  KEY `student_id` (`student_id`),
  KEY `model_id` (`model_id`),
  KEY `idx_ai_predictions_risk` (`risk_level`),
  KEY `idx_ai_predictions_type` (`prediction_type`),
  CONSTRAINT `chk_prediction_confidence` CHECK (((`confidence_score` is null) or ((`confidence_score` >= 0) and (`confidence_score` <= 100))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- analytics_dashboard_cards
DROP TABLE IF EXISTS `analytics_dashboard_cards`;
CREATE TABLE `analytics_dashboard_cards` (
  `card_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `surface` enum('dashboard','ai_insights','faculty_insights','faculty_dashboard','faculty_attendance') COLLATE utf8mb4_unicode_ci NOT NULL,
  `saved_query_id` int DEFAULT NULL,
  `builtin_key` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visual` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `grid_x` int NOT NULL DEFAULT '0',
  `grid_y` int NOT NULL DEFAULT '0',
  `grid_w` int NOT NULL DEFAULT '6',
  `grid_h` int NOT NULL DEFAULT '8',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `user_sized` tinyint(1) NOT NULL DEFAULT '0',
  `breakpoint` enum('lg','sm') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'lg',
  PRIMARY KEY (`card_id`),
  KEY `saved_query_id` (`saved_query_id`),
  KEY `ix_analytics_cards_user_surface_bp` (`user_id`,`surface`,`breakpoint`),
  CONSTRAINT `ck_analytics_cards_one_source` CHECK ((((`saved_query_id` is not null) and (`builtin_key` is null)) or ((`saved_query_id` is null) and (`builtin_key` is not null))))
) ENGINE=InnoDB AUTO_INCREMENT=3109 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- announcement_targets
DROP TABLE IF EXISTS `announcement_targets`;
CREATE TABLE `announcement_targets` (
  `target_id` int NOT NULL AUTO_INCREMENT,
  `announcement_id` int NOT NULL,
  `role_id` int DEFAULT NULL,
  `program_id` int DEFAULT NULL,
  `batch_id` int DEFAULT NULL,
  `section_id` int DEFAULT NULL,
  `semester_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`target_id`),
  KEY `fk_at_program` (`program_id`),
  KEY `fk_at_section` (`section_id`),
  KEY `fk_at_sem` (`semester_id`),
  KEY `idx_at_announcement` (`announcement_id`),
  KEY `idx_at_user` (`user_id`),
  KEY `idx_at_role` (`role_id`),
  KEY `idx_at_placement` (`batch_id`,`section_id`,`program_id`,`semester_id`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------- announcements
DROP TABLE IF EXISTS `announcements`;
CREATE TABLE `announcements` (
  `announcement_id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_role` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `posted_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`announcement_id`),
  KEY `posted_by` (`posted_by`),
  KEY `idx_announcements_role` (`target_role`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- assistant_conversations
DROP TABLE IF EXISTS `assistant_conversations`;
CREATE TABLE `assistant_conversations` (
  `conversation_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `role_id` int NOT NULL,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'New conversation',
  `portal` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`conversation_id`),
  KEY `role_id` (`role_id`),
  KEY `idx_assistant_conv_user` (`user_id`,`updated_at`)
) ENGINE=InnoDB AUTO_INCREMENT=176 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- assistant_messages
DROP TABLE IF EXISTS `assistant_messages`;
CREATE TABLE `assistant_messages` (
  `message_id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` int NOT NULL,
  `role` enum('user','assistant','tool','system') COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` mediumtext COLLATE utf8mb4_unicode_ci,
  `tool_calls` json DEFAULT NULL,
  `tool_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `response_type` enum('answer','table','chart','knowledge','error','capabilities','scope') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `response_payload` json DEFAULT NULL,
  `token_count` int DEFAULT NULL,
  `latency_ms` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_id`),
  KEY `idx_assistant_msg_thread` (`conversation_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=474 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- assistant_query_log
DROP TABLE IF EXISTS `assistant_query_log`;
CREATE TABLE `assistant_query_log` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` int DEFAULT NULL,
  `user_id` int NOT NULL,
  `role_id` int NOT NULL,
  `tool_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tool_args` json DEFAULT NULL,
  `resolved_scope` json DEFAULT NULL,
  `executed_sql` text COLLATE utf8mb4_unicode_ci,
  `row_count` int DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `outcome` enum('success','refused','error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'success',
  `error_message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `conversation_id` (`conversation_id`),
  KEY `idx_assistant_log_user` (`user_id`,`created_at`),
  KEY `idx_assistant_log_outcome` (`outcome`,`created_at`),
  KEY `idx_assistant_log_tool` (`tool_name`)
) ENGINE=InnoDB AUTO_INCREMENT=1485 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- attendance
DROP TABLE IF EXISTS `attendance`;
CREATE TABLE `attendance` (
  `attendance_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `subject_id` int NOT NULL,
  `timetable_id` int NOT NULL,
  `att_date` date NOT NULL,
  `status` enum('Present','Absent','Late','Leave','Holiday') COLLATE utf8mb4_unicode_ci NOT NULL,
  `marked_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`attendance_id`),
  UNIQUE KEY `uq_attendance_once` (`student_id`,`timetable_id`,`att_date`),
  KEY `subject_id` (`subject_id`),
  KEY `timetable_id` (`timetable_id`),
  KEY `marked_by` (`marked_by`),
  KEY `idx_attendance_date` (`att_date`),
  KEY `idx_attendance_student_subject_date` (`student_id`,`subject_id`,`att_date`)
) ENGINE=InnoDB AUTO_INCREMENT=61214 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- audit_logs
DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_affected` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_value` json DEFAULT NULL,
  `new_value` json DEFAULT NULL,
  `action_timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`log_id`),
  KEY `user_id` (`user_id`),
  KEY `idx_audit_logs_time` (`action_timestamp`),
  KEY `idx_audit_logs_module` (`module`)
) ENGINE=InnoDB AUTO_INCREMENT=92 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- batches
DROP TABLE IF EXISTS `batches`;
CREATE TABLE `batches` (
  `batch_id` int NOT NULL AUTO_INCREMENT,
  `program_id` int NOT NULL,
  `batch_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_year` year NOT NULL,
  `end_year` year NOT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`batch_id`),
  KEY `program_id` (`program_id`),
  KEY `idx_batches_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- book_issues
DROP TABLE IF EXISTS `book_issues`;
CREATE TABLE `book_issues` (
  `issue_id` int NOT NULL AUTO_INCREMENT,
  `book_id` int NOT NULL,
  `borrower_user_id` int NOT NULL,
  `issue_date` date NOT NULL,
  `due_date` date NOT NULL,
  `return_date` date DEFAULT NULL,
  `fine_amount` decimal(8,2) DEFAULT '0.00',
  PRIMARY KEY (`issue_id`),
  KEY `book_id` (`book_id`),
  KEY `borrower_user_id` (`borrower_user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=296 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- books
DROP TABLE IF EXISTS `books`;
CREATE TABLE `books` (
  `book_id` int NOT NULL AUTO_INCREMENT,
  `isbn` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_copies` int NOT NULL DEFAULT '1',
  `available_copies` int NOT NULL DEFAULT '1',
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`book_id`),
  UNIQUE KEY `isbn` (`isbn`),
  KEY `idx_books_deleted` (`is_deleted`),
  CONSTRAINT `chk_books_available_copies` CHECK (((`available_copies` >= 0) and (`available_copies` <= `total_copies`))),
  CONSTRAINT `chk_books_total_copies` CHECK ((`total_copies` >= 0))
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- classrooms
DROP TABLE IF EXISTS `classrooms`;
CREATE TABLE `classrooms` (
  `classroom_id` int NOT NULL AUTO_INCREMENT,
  `room_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `building` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int NOT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  `room_type` enum('Lecture','Lab','Auditorium','Seminar') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Lecture',
  PRIMARY KEY (`classroom_id`),
  UNIQUE KEY `uq_room_per_building` (`room_name`,`building`),
  KEY `idx_classrooms_deleted` (`is_deleted`),
  KEY `idx_classrooms_type_capacity` (`room_type`,`capacity`)
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- course_offerings
DROP TABLE IF EXISTS `course_offerings`;
CREATE TABLE `course_offerings` (
  `offering_id` int NOT NULL AUTO_INCREMENT,
  `term_id` int NOT NULL,
  `section_id` int NOT NULL,
  `subject_id` int NOT NULL,
  `teacher_id` int DEFAULT NULL,
  `sessions_per_week` tinyint DEFAULT NULL COMMENT 'NULL = follow subjects.sessions_per_week. Set only to override for this term.',
  `required_room_type` enum('Lecture','Lab','Auditorium','Seminar') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_seats` int DEFAULT NULL,
  `status` enum('Draft','Scheduled','Active','Completed','Cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Draft',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`offering_id`),
  UNIQUE KEY `uq_offering_term_section_subject` (`term_id`,`section_id`,`subject_id`),
  KEY `section_id` (`section_id`),
  KEY `subject_id` (`subject_id`),
  KEY `idx_offering_teacher_term` (`teacher_id`,`term_id`),
  KEY `idx_offering_term_status` (`term_id`,`status`,`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=56 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- dashboard_widgets
DROP TABLE IF EXISTS `dashboard_widgets`;
CREATE TABLE `dashboard_widgets` (
  `widget_id` int NOT NULL AUTO_INCREMENT,
  `role_id` int NOT NULL,
  `widget_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_json` json DEFAULT NULL,
  PRIMARY KEY (`widget_id`),
  KEY `role_id` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- departments
DROP TABLE IF EXISTS `departments`;
CREATE TABLE `departments` (
  `department_id` int NOT NULL AUTO_INCREMENT,
  `department_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `head_employee_id` int DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`department_id`),
  UNIQUE KEY `department_name` (`department_name`),
  KEY `head_employee_id` (`head_employee_id`),
  KEY `idx_departments_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- employee_documents
DROP TABLE IF EXISTS `employee_documents`;
CREATE TABLE `employee_documents` (
  `doc_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `doc_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `verified` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`doc_id`),
  KEY `employee_id` (`employee_id`)
) ENGINE=InnoDB AUTO_INCREMENT=127 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- employees
DROP TABLE IF EXISTS `employees`;
CREATE TABLE `employees` (
  `employee_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `employee_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `department_id` int NOT NULL,
  `designation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `basic_salary` decimal(12,2) NOT NULL,
  `hire_date` date NOT NULL,
  `employment_status` enum('Active','On Leave','Terminated','Retired') COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`employee_id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `employee_code` (`employee_code`),
  KEY `department_id` (`department_id`),
  KEY `idx_employees_status` (`employment_status`),
  KEY `idx_employees_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- enrollments
DROP TABLE IF EXISTS `enrollments`;
CREATE TABLE `enrollments` (
  `enrollment_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `subject_id` int NOT NULL,
  `semester_id` int NOT NULL,
  `enrollment_date` date NOT NULL,
  `status` enum('Active','Completed','Dropped') COLLATE utf8mb4_unicode_ci DEFAULT 'Active',
  `offering_id` int DEFAULT NULL,
  `term_id` int DEFAULT NULL,
  PRIMARY KEY (`enrollment_id`),
  UNIQUE KEY `uq_enrollment_once_per_term` (`student_id`,`subject_id`,`semester_id`,`term_id`),
  KEY `subject_id` (`subject_id`),
  KEY `semester_id` (`semester_id`),
  KEY `term_id` (`term_id`),
  KEY `idx_enrollments_student_fk` (`student_id`),
  KEY `idx_enrollments_offering` (`offering_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=10004 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- exams
DROP TABLE IF EXISTS `exams`;
CREATE TABLE `exams` (
  `exam_id` int NOT NULL AUTO_INCREMENT,
  `exam_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `exam_type` enum('Quiz','Assignment','Mid-Term','Final','Practical','Viva') COLLATE utf8mb4_unicode_ci NOT NULL,
  `semester_id` int NOT NULL,
  `subject_id` int NOT NULL,
  `exam_date` date NOT NULL,
  `total_marks` int NOT NULL,
  `classroom_id` int DEFAULT NULL,
  `invigilator_id` int DEFAULT NULL,
  PRIMARY KEY (`exam_id`),
  KEY `semester_id` (`semester_id`),
  KEY `subject_id` (`subject_id`),
  KEY `classroom_id` (`classroom_id`),
  KEY `invigilator_id` (`invigilator_id`),
  KEY `idx_exams_date` (`exam_date`),
  CONSTRAINT `chk_exams_total_marks` CHECK ((`total_marks` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=61 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- fee_payments
DROP TABLE IF EXISTS `fee_payments`;
CREATE TABLE `fee_payments` (
  `fee_payment_id` int NOT NULL AUTO_INCREMENT,
  `fee_voucher_id` int NOT NULL,
  `receipt_number` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount_paid` decimal(12,2) NOT NULL,
  `payment_method` enum('Cash','Bank Transfer','Card','Mobile Wallet','Online','Cheque','Other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Other',
  `payment_date` date DEFAULT NULL,
  `is_late` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('Pending','Verified','Rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Verified',
  `recorded_by` int DEFAULT NULL,
  `submitted_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verified_at` datetime DEFAULT NULL COMMENT 'When the accounts office approved or refused this payment',
  `verified_by` int DEFAULT NULL COMMENT 'The user who decided this payment; NULL for rows decided before this was tracked',
  PRIMARY KEY (`fee_payment_id`),
  UNIQUE KEY `receipt_number` (`receipt_number`),
  KEY `recorded_by` (`recorded_by`),
  KEY `fee_payments_fee_voucher_id` (`fee_voucher_id`),
  KEY `fee_payments_payment_date` (`payment_date`),
  KEY `idx_fee_payments_status` (`status`),
  KEY `fee_payments_verified_by_foreign_idx` (`verified_by`),
  KEY `idx_fee_payments_verified_at` (`verified_at`)
) ENGINE=InnoDB AUTO_INCREMENT=1921 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- fee_structures
DROP TABLE IF EXISTS `fee_structures`;
CREATE TABLE `fee_structures` (
  `fee_structure_id` int NOT NULL AUTO_INCREMENT,
  `program_id` int NOT NULL,
  `semester_id` int NOT NULL,
  `fee_category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  PRIMARY KEY (`fee_structure_id`),
  KEY `program_id` (`program_id`),
  KEY `semester_id` (`semester_id`)
) ENGINE=InnoDB AUTO_INCREMENT=128 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- fee_vouchers
DROP TABLE IF EXISTS `fee_vouchers`;
CREATE TABLE `fee_vouchers` (
  `fee_voucher_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `fee_structure_id` int DEFAULT NULL,
  `semester_id` int DEFAULT NULL,
  `voucher_number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issue_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `total_payable` decimal(12,2) NOT NULL DEFAULT '0.00',
  `amount_paid` decimal(12,2) NOT NULL DEFAULT '0.00',
  `remaining_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` enum('Unpaid','Partial','Paid','Overdue','Cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Unpaid',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`fee_voucher_id`),
  UNIQUE KEY `voucher_number` (`voucher_number`),
  KEY `fee_structure_id` (`fee_structure_id`),
  KEY `semester_id` (`semester_id`),
  KEY `fee_vouchers_student_id` (`student_id`),
  KEY `fee_vouchers_status` (`status`),
  KEY `fee_vouchers_due_date` (`due_date`)
) ENGINE=InnoDB AUTO_INCREMENT=2014 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- gpa
DROP TABLE IF EXISTS `gpa`;
CREATE TABLE `gpa` (
  `gpa_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `semester_id` int NOT NULL,
  `gpa` decimal(3,2) NOT NULL,
  `cgpa` decimal(3,2) NOT NULL,
  PRIMARY KEY (`gpa_id`),
  KEY `fk_gpa_student` (`student_id`),
  KEY `fk_gpa_semester` (`semester_id`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- grades
DROP TABLE IF EXISTS `grades`;
CREATE TABLE `grades` (
  `grade_id` int NOT NULL AUTO_INCREMENT,
  `grade_letter` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_percentage` decimal(5,2) NOT NULL,
  `max_percentage` decimal(5,2) NOT NULL,
  `grade_point` decimal(3,2) NOT NULL,
  PRIMARY KEY (`grade_id`),
  UNIQUE KEY `grade_letter` (`grade_letter`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- leave_requests
DROP TABLE IF EXISTS `leave_requests`;
CREATE TABLE `leave_requests` (
  `leave_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `leave_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('Pending','Approved','Rejected') COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `approved_by` int DEFAULT NULL,
  PRIMARY KEY (`leave_id`),
  KEY `user_id` (`user_id`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_leave_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=161 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- marks
DROP TABLE IF EXISTS `marks`;
CREATE TABLE `marks` (
  `mark_id` int NOT NULL AUTO_INCREMENT,
  `exam_id` int NOT NULL,
  `student_id` int NOT NULL,
  `obtained_marks` decimal(6,2) NOT NULL,
  `entered_by` int NOT NULL,
  `verified_by` int DEFAULT NULL,
  `status` enum('Draft','Verified','Published') COLLATE utf8mb4_unicode_ci DEFAULT 'Draft',
  PRIMARY KEY (`mark_id`),
  UNIQUE KEY `uq_marks_once` (`exam_id`,`student_id`),
  KEY `student_id` (`student_id`),
  KEY `entered_by` (`entered_by`),
  KEY `verified_by` (`verified_by`),
  KEY `idx_marks_status` (`status`),
  CONSTRAINT `chk_marks_obtained` CHECK ((`obtained_marks` >= 0))
) ENGINE=InnoDB AUTO_INCREMENT=20013 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- meeting_requests
DROP TABLE IF EXISTS `meeting_requests`;
CREATE TABLE `meeting_requests` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `parent_id` int NOT NULL,
  `teacher_id` int NOT NULL,
  `requested_date` datetime NOT NULL,
  `status` enum('Pending','Approved','Rejected','Completed') COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  KEY `parent_id` (`parent_id`),
  KEY `teacher_id` (`teacher_id`)
) ENGINE=InnoDB AUTO_INCREMENT=221 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- notifications
DROP TABLE IF EXISTS `notifications`;
CREATE TABLE `notifications` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `message` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `title` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Notification' COMMENT 'Heading for the row, composed by whichever service emitted it',
  `link` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'In-portal route this notification is about; NULL when there is nothing to open',
  `priority` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal' COMMENT 'low | normal | high — drives the tone the portals render',
  PRIMARY KEY (`notification_id`),
  KEY `idx_notifications_unread` (`user_id`,`is_read`),
  KEY `idx_notifications_feed` (`user_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2435 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- parents
DROP TABLE IF EXISTS `parents`;
CREATE TABLE `parents` (
  `parent_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `occupation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`parent_id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `idx_parents_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=2010 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- payroll
DROP TABLE IF EXISTS `payroll`;
CREATE TABLE `payroll` (
  `payroll_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `basic_salary` decimal(12,2) NOT NULL,
  `allowances` decimal(12,2) DEFAULT '0.00',
  `deductions` decimal(12,2) DEFAULT '0.00',
  `net_salary` decimal(12,2) NOT NULL,
  `generated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`payroll_id`),
  UNIQUE KEY `uq_payroll_once` (`employee_id`,`month`)
) ENGINE=InnoDB AUTO_INCREMENT=193 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- performance_evaluations
DROP TABLE IF EXISTS `performance_evaluations`;
CREATE TABLE `performance_evaluations` (
  `evaluation_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `evaluation_period` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rating` enum('Excellent','Good','Average','Poor') COLLATE utf8mb4_unicode_ci NOT NULL,
  `remarks` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `evaluated_by` int NOT NULL,
  PRIMARY KEY (`evaluation_id`),
  KEY `employee_id` (`employee_id`),
  KEY `evaluated_by` (`evaluated_by`)
) ENGINE=InnoDB AUTO_INCREMENT=65 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- permissions
DROP TABLE IF EXISTS `permissions`;
CREATE TABLE `permissions` (
  `permission_id` int NOT NULL AUTO_INCREMENT,
  `permission_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`permission_id`),
  UNIQUE KEY `permission_name` (`permission_name`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='NOT READ BY THE APPLICATION. Authorisation is role-id only, in middlewares/rbac.middleware.js. Seeded and kept for referential completeness and for a future permission-level check. See GAPS_AND_LIMITATIONS.md section 6.';

-- ------------------------------------------------- prediction_history
DROP TABLE IF EXISTS `prediction_history`;
CREATE TABLE `prediction_history` (
  `history_id` int NOT NULL AUTO_INCREMENT,
  `prediction_id` int NOT NULL,
  `student_id` int NOT NULL,
  `predicted_value` decimal(6,2) DEFAULT NULL,
  `risk_level` enum('Low','Medium','High','Critical') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confidence_score` decimal(5,2) DEFAULT NULL,
  `recorded_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`history_id`),
  KEY `prediction_id` (`prediction_id`),
  KEY `idx_prediction_history_student` (`student_id`),
  CONSTRAINT `chk_prediction_history_confidence` CHECK (((`confidence_score` is null) or ((`confidence_score` >= 0) and (`confidence_score` <= 100))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- prediction_models
DROP TABLE IF EXISTS `prediction_models`;
CREATE TABLE `prediction_models` (
  `model_id` int NOT NULL AUTO_INCREMENT,
  `model_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_type` enum('Performance','Fee Default','Attendance Risk') COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `trained_on` datetime NOT NULL,
  `accuracy_score` decimal(5,2) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`model_id`),
  UNIQUE KEY `uq_model_version` (`model_name`,`version`),
  KEY `idx_prediction_models_type` (`model_type`),
  KEY `idx_prediction_models_active` (`is_active`),
  CONSTRAINT `chk_model_accuracy` CHECK (((`accuracy_score` is null) or ((`accuracy_score` >= 0) and (`accuracy_score` <= 100))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- programs
DROP TABLE IF EXISTS `programs`;
CREATE TABLE `programs` (
  `program_id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `program_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `duration_semesters` int NOT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`program_id`),
  UNIQUE KEY `uq_program_per_department` (`department_id`,`program_name`),
  KEY `idx_programs_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=347 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- reports
DROP TABLE IF EXISTS `reports`;
CREATE TABLE `reports` (
  `report_id` int NOT NULL AUTO_INCREMENT,
  `report_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `generated_by` int NOT NULL,
  `generated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `file_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `format` enum('PDF','Excel','CSV') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`report_id`),
  KEY `generated_by` (`generated_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- results
DROP TABLE IF EXISTS `results`;
CREATE TABLE `results` (
  `result_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `semester_id` int NOT NULL,
  `gpa` decimal(3,2) DEFAULT NULL,
  `cgpa` decimal(3,2) DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `status` enum('Pending','Published') COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  PRIMARY KEY (`result_id`),
  UNIQUE KEY `uq_result_once` (`student_id`,`semester_id`),
  KEY `semester_id` (`semester_id`),
  KEY `idx_results_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2414 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- role_permissions
DROP TABLE IF EXISTS `role_permissions`;
CREATE TABLE `role_permissions` (
  `role_id` int NOT NULL,
  `permission_id` int NOT NULL,
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `permission_id` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='NOT READ BY THE APPLICATION. Authorisation is role-id only, in middlewares/rbac.middleware.js. Seeded and kept for referential completeness and for a future permission-level check. See GAPS_AND_LIMITATIONS.md section 6.';

-- ------------------------------------------------- roles
DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `role_id` int NOT NULL AUTO_INCREMENT,
  `role_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `role_name` (`role_name`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- saved_analytics_queries
DROP TABLE IF EXISTS `saved_analytics_queries`;
CREATE TABLE `saved_analytics_queries` (
  `saved_query_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `corrected_question` text COLLATE utf8mb4_unicode_ci,
  `source_kind` enum('tool','sql') COLLATE utf8mb4_unicode_ci NOT NULL,
  `tool_name` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tool_args` json DEFAULT NULL,
  `sql_text` text COLLATE utf8mb4_unicode_ci,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `visuals` json NOT NULL,
  `default_visual` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `axes` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`saved_query_id`),
  UNIQUE KEY `uq_saved_analytics_user_name` (`user_id`,`name`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- scholarships
DROP TABLE IF EXISTS `scholarships`;
CREATE TABLE `scholarships` (
  `scholarship_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `semester_id` int NOT NULL,
  `scholarship_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `discount_percentage` decimal(5,2) NOT NULL,
  `approved_by` int NOT NULL,
  PRIMARY KEY (`scholarship_id`),
  KEY `student_id` (`student_id`),
  KEY `semester_id` (`semester_id`),
  KEY `approved_by` (`approved_by`),
  CONSTRAINT `chk_scholarship_discount` CHECK (((`discount_percentage` > 0) and (`discount_percentage` <= 100)))
) ENGINE=InnoDB AUTO_INCREMENT=261 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- sections
DROP TABLE IF EXISTS `sections`;
CREATE TABLE `sections` (
  `section_id` int NOT NULL AUTO_INCREMENT,
  `batch_id` int NOT NULL,
  `section_name` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int DEFAULT '40',
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`section_id`),
  KEY `batch_id` (`batch_id`),
  KEY `idx_sections_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- semesters
DROP TABLE IF EXISTS `semesters`;
CREATE TABLE `semesters` (
  `semester_id` int NOT NULL AUTO_INCREMENT,
  `program_id` int NOT NULL,
  `semester_number` int NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_archived` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`semester_id`),
  KEY `program_id` (`program_id`)
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- student_documents
DROP TABLE IF EXISTS `student_documents`;
CREATE TABLE `student_documents` (
  `doc_id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `doc_type` enum('CNIC','B-Form','Photo','Certificate','Transcript','Medical','Admission Form','Fee Challan','Result Card','Other') COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Legacy disk path. NULL for documents stored as file_data.',
  `verified` tinyint(1) DEFAULT '0',
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `file_data` mediumblob COMMENT 'Document bytes. NULL means fall back to the file_url path.',
  `file_mime` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Content-Type for file_data',
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Original filename, for the Content-Disposition on download',
  `file_size` int DEFAULT NULL COMMENT 'Byte length of file_data',
  `file_checksum` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SHA-256 of file_data, served as the HTTP ETag',
  PRIMARY KEY (`doc_id`),
  KEY `student_id` (`student_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8031 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- student_guardians
DROP TABLE IF EXISTS `student_guardians`;
CREATE TABLE `student_guardians` (
  `student_id` int NOT NULL,
  `parent_id` int NOT NULL,
  `relationship` enum('Father','Mother','Guardian') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`student_id`,`parent_id`),
  KEY `parent_id` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- students
DROP TABLE IF EXISTS `students`;
CREATE TABLE `students` (
  `student_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `registration_number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cnic_bform` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `program_id` int NOT NULL,
  `batch_id` int NOT NULL,
  `section_id` int DEFAULT NULL,
  `academic_status` enum('Pending Verification','Active','Suspended','Withdrawn','Graduated','Alumni') COLLATE utf8mb4_unicode_ci DEFAULT 'Pending Verification',
  `is_deleted` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `gender` enum('Male','Female','Other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_semester_id` int DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nationality` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `blood_group` enum('A+','A-','B+','B-','AB+','AB-','O+','O-') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`student_id`),
  UNIQUE KEY `registration_number` (`registration_number`),
  UNIQUE KEY `cnic_bform` (`cnic_bform`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `program_id` (`program_id`),
  KEY `batch_id` (`batch_id`),
  KEY `section_id` (`section_id`),
  KEY `idx_students_status` (`academic_status`),
  KEY `idx_students_name` (`first_name`,`last_name`),
  KEY `idx_students_deleted` (`is_deleted`),
  KEY `students_current_semester_id_foreign_idx` (`current_semester_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2028 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- subjects
DROP TABLE IF EXISTS `subjects`;
CREATE TABLE `subjects` (
  `subject_id` int NOT NULL AUTO_INCREMENT,
  `subject_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `credit_hours` int NOT NULL,
  `semester_id` int NOT NULL,
  `prerequisite_subject_id` int DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  `required_room_type` enum('Lecture','Lab','Auditorium','Seminar') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sessions_per_week` int NOT NULL DEFAULT '2',
  PRIMARY KEY (`subject_id`),
  UNIQUE KEY `subject_code` (`subject_code`),
  KEY `semester_id` (`semester_id`),
  KEY `prerequisite_subject_id` (`prerequisite_subject_id`),
  KEY `idx_subjects_deleted` (`is_deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=1014 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- teacher_assignments
DROP TABLE IF EXISTS `teacher_assignments`;
CREATE TABLE `teacher_assignments` (
  `assignment_id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `subject_id` int NOT NULL,
  `batch_id` int NOT NULL,
  `section_id` int NOT NULL,
  `assigned_date` date NOT NULL,
  PRIMARY KEY (`assignment_id`),
  KEY `fk_ta_teacher` (`teacher_id`),
  KEY `fk_ta_subject` (`subject_id`),
  KEY `fk_ta_batch` (`batch_id`)
) ENGINE=InnoDB AUTO_INCREMENT=44 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- teacher_attendance
DROP TABLE IF EXISTS `teacher_attendance`;
CREATE TABLE `teacher_attendance` (
  `teacher_attendance_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `att_date` date NOT NULL,
  `check_in` time DEFAULT NULL,
  `check_out` time DEFAULT NULL,
  `status` enum('Present','Absent','Late','Leave') COLLATE utf8mb4_unicode_ci DEFAULT 'Present',
  PRIMARY KEY (`teacher_attendance_id`),
  UNIQUE KEY `uq_teacher_attendance_once` (`employee_id`,`att_date`),
  KEY `idx_teacher_attendance_dt` (`att_date`)
) ENGINE=InnoDB AUTO_INCREMENT=2113 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- teacher_profiles
DROP TABLE IF EXISTS `teacher_profiles`;
CREATE TABLE `teacher_profiles` (
  `teacher_id` int NOT NULL,
  `qualification` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `specialization` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `experience_years` int DEFAULT NULL,
  `bio` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- teacher_schedules
DROP TABLE IF EXISTS `teacher_schedules`;
CREATE TABLE `teacher_schedules` (
  `schedule_id` int NOT NULL AUTO_INCREMENT,
  `teacher_id` int NOT NULL,
  `subject_id` int NOT NULL,
  `day` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `room` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`schedule_id`),
  KEY `fk_ts_teacher` (`teacher_id`),
  KEY `fk_ts_subject` (`subject_id`)
) ENGINE=InnoDB AUTO_INCREMENT=48 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- teacher_subjects
DROP TABLE IF EXISTS `teacher_subjects`;
CREATE TABLE `teacher_subjects` (
  `teacher_id` int NOT NULL,
  `subject_id` int NOT NULL,
  PRIMARY KEY (`teacher_id`,`subject_id`),
  KEY `subject_id` (`subject_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- teachers
DROP TABLE IF EXISTS `teachers`;
CREATE TABLE `teachers` (
  `teacher_id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `specialization` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`teacher_id`),
  UNIQUE KEY `uq_teachers_active_employee` ((if((`is_deleted` = 1),NULL,`employee_id`))),
  KEY `idx_teachers_deleted` (`is_deleted`),
  KEY `idx_teachers_employee` (`employee_id`)
) ENGINE=InnoDB AUTO_INCREMENT=87 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- timetables
DROP TABLE IF EXISTS `timetables`;
CREATE TABLE `timetables` (
  `timetable_id` int NOT NULL AUTO_INCREMENT,
  `subject_id` int NOT NULL,
  `section_id` int NOT NULL,
  `teacher_id` int NOT NULL,
  `classroom_id` int NOT NULL,
  `day_of_week` enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `offering_id` int DEFAULT NULL,
  `term_id` int DEFAULT NULL,
  PRIMARY KEY (`timetable_id`),
  UNIQUE KEY `uq_timetable_section_slot` (`term_id`,`section_id`,`day_of_week`,`start_time`),
  UNIQUE KEY `uq_timetable_teacher_slot` (`term_id`,`teacher_id`,`day_of_week`,`start_time`),
  UNIQUE KEY `uq_timetable_classroom_slot` (`term_id`,`classroom_id`,`day_of_week`,`start_time`),
  KEY `subject_id` (`subject_id`),
  KEY `idx_timetables_teacher_schedule` (`teacher_id`,`day_of_week`,`start_time`),
  KEY `idx_timetables_section_schedule` (`section_id`,`day_of_week`,`start_time`),
  KEY `idx_timetables_offering` (`offering_id`),
  KEY `idx_timetables_teacher_fk` (`teacher_id`),
  KEY `idx_timetables_classroom_fk` (`classroom_id`)
) ENGINE=InnoDB AUTO_INCREMENT=116 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- user_preferences
DROP TABLE IF EXISTS `user_preferences`;
CREATE TABLE `user_preferences` (
  `user_id` int NOT NULL,
  `preferences` json NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------- users
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_id` int NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `profile_picture` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `email_verified` tinyint(1) DEFAULT '1',
  `failed_login_attempts` int DEFAULT '0',
  `last_login` datetime DEFAULT NULL,
  `last_password_change` datetime DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `must_change_password` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Set when an admin issued this password; cleared once the user picks their own',
  `credentials_issued_at` datetime DEFAULT NULL COMMENT 'When admin-generated credentials were last issued for this account',
  `profile_picture_data` mediumblob COMMENT 'Avatar bytes. NULL means fall back to the profile_picture path.',
  `profile_picture_mime` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Content-Type for profile_picture_data, e.g. image/webp',
  `profile_picture_size` int DEFAULT NULL COMMENT 'Byte length of profile_picture_data, so listings need not read the blob',
  `profile_picture_checksum` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SHA-256 of profile_picture_data, served as the HTTP ETag',
  `profile_picture_updated_at` datetime DEFAULT NULL COMMENT 'When the avatar bytes were last replaced; served as Last-Modified',
  `full_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Display name for the account holder. Backfilled from the role record (students/employees/parents) where one exists; set directly for accounts that have none, such as administrators.',
  `locked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  KEY `role_id` (`role_id`),
  KEY `idx_users_deleted` (`is_deleted`),
  CONSTRAINT `chk_users_failed_logins` CHECK ((`failed_login_attempts` >= 0))
) ENGINE=InnoDB AUTO_INCREMENT=4077 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- Views (21)
-- =====================================================================

DROP VIEW IF EXISTS `vw_student_attendance_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_student_attendance_summary` AS select `a`.`student_id` AS `student_id`,`a`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`semester_id` AS `semester_id`,count(0) AS `total_sessions`,sum((`a`.`status` = 'Present')) AS `present_count`,sum((`a`.`status` = 'Absent')) AS `absent_count`,sum((`a`.`status` = 'Late')) AS `late_count`,sum((`a`.`status` = 'Leave')) AS `leave_count`,min(`a`.`att_date`) AS `first_session`,max(`a`.`att_date`) AS `last_session`,round(((sum((`a`.`status` in ('Present','Late'))) / count(0)) * 100),2) AS `attendance_percentage`,round(((sum((`a`.`status` = 'Present')) / count(0)) * 100),2) AS `strict_attendance_percentage` from ((`attendance` `a` join `subjects` `sub` on(((`sub`.`subject_id` = `a`.`subject_id`) and (`sub`.`is_deleted` = 0)))) join `students` `st` on(((`st`.`student_id` = `a`.`student_id`) and (`st`.`is_deleted` = 0)))) where (`a`.`status` <> 'Holiday') group by `a`.`student_id`,`a`.`subject_id`,`sub`.`subject_code`,`sub`.`subject_name`,`sub`.`semester_id`;

DROP VIEW IF EXISTS `vw_at_risk_students`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_at_risk_students` AS select `st`.`student_id` AS `student_id`,`st`.`registration_number` AS `registration_number`,concat(`st`.`first_name`,' ',`st`.`last_name`) AS `full_name`,`st`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`st`.`batch_id` AS `batch_id`,`st`.`section_id` AS `section_id`,`st`.`academic_status` AS `academic_status`,`att`.`subjects_tracked` AS `subjects_tracked`,`att`.`avg_attendance_percentage` AS `avg_attendance_percentage`,`att`.`lowest_attendance_percentage` AS `lowest_attendance_percentage`,`res`.`latest_gpa` AS `latest_gpa`,`res`.`latest_cgpa` AS `latest_cgpa`,`fee`.`unpaid_vouchers` AS `unpaid_vouchers`,`fee`.`outstanding_balance` AS `outstanding_balance`,`fee`.`max_days_overdue` AS `max_days_overdue` from ((((`students` `st` left join `programs` `p` on((`p`.`program_id` = `st`.`program_id`))) left join (select `vw_student_attendance_summary`.`student_id` AS `student_id`,count(0) AS `subjects_tracked`,round(avg(`vw_student_attendance_summary`.`attendance_percentage`),2) AS `avg_attendance_percentage`,min(`vw_student_attendance_summary`.`attendance_percentage`) AS `lowest_attendance_percentage` from `vw_student_attendance_summary` group by `vw_student_attendance_summary`.`student_id`) `att` on((`att`.`student_id` = `st`.`student_id`))) left join (select `r`.`student_id` AS `student_id`,`r`.`gpa` AS `latest_gpa`,`r`.`cgpa` AS `latest_cgpa` from (`results` `r` join (select `results`.`student_id` AS `student_id`,max(`results`.`semester_id`) AS `semester_id` from `results` where (`results`.`status` = 'Published') group by `results`.`student_id`) `latest` on(((`latest`.`student_id` = `r`.`student_id`) and (`latest`.`semester_id` = `r`.`semester_id`)))) where (`r`.`status` = 'Published')) `res` on((`res`.`student_id` = `st`.`student_id`))) left join (select `fee_vouchers`.`student_id` AS `student_id`,count(0) AS `unpaid_vouchers`,sum(`fee_vouchers`.`remaining_balance`) AS `outstanding_balance`,max(greatest((to_days(curdate()) - to_days(`fee_vouchers`.`due_date`)),0)) AS `max_days_overdue` from `fee_vouchers` where (`fee_vouchers`.`status` not in ('Paid','Cancelled')) group by `fee_vouchers`.`student_id`) `fee` on((`fee`.`student_id` = `st`.`student_id`))) where (`st`.`is_deleted` = 0);

DROP VIEW IF EXISTS `vw_attendance_daily`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_attendance_daily` AS select `a`.`att_date` AS `att_date`,`a`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`semester_id` AS `semester_id`,`tt`.`section_id` AS `section_id`,`st`.`program_id` AS `program_id`,`st`.`batch_id` AS `batch_id`,count(0) AS `marked_count`,sum((`a`.`status` = 'Present')) AS `present_count`,sum((`a`.`status` = 'Absent')) AS `absent_count`,sum((`a`.`status` = 'Late')) AS `late_count`,sum((`a`.`status` = 'Leave')) AS `leave_count`,sum((`a`.`status` = 'Holiday')) AS `holiday_count`,round(((sum((`a`.`status` in ('Present','Late'))) / nullif(sum((`a`.`status` <> 'Holiday')),0)) * 100),2) AS `attendance_percentage` from (((`attendance` `a` join `subjects` `sub` on(((`sub`.`subject_id` = `a`.`subject_id`) and (`sub`.`is_deleted` = 0)))) join `students` `st` on(((`st`.`student_id` = `a`.`student_id`) and (`st`.`is_deleted` = 0)))) left join `timetables` `tt` on((`tt`.`timetable_id` = `a`.`timetable_id`))) group by `a`.`att_date`,`a`.`subject_id`,`sub`.`subject_code`,`sub`.`subject_name`,`sub`.`semester_id`,`tt`.`section_id`,`st`.`program_id`,`st`.`batch_id`;

DROP VIEW IF EXISTS `vw_book_availability`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_book_availability` AS select `books`.`book_id` AS `book_id`,`books`.`title` AS `title`,`books`.`author` AS `author`,`books`.`category` AS `category`,`books`.`total_copies` AS `total_copies`,`books`.`available_copies` AS `available_copies`,(`books`.`total_copies` - `books`.`available_copies`) AS `copies_issued` from `books` where (`books`.`is_deleted` = false);

DROP VIEW IF EXISTS `vw_class_performance_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_class_performance_summary` AS select `per_student`.`section_id` AS `section_id`,`per_student`.`subject_id` AS `subject_id`,`per_student`.`subject_name` AS `subject_name`,`per_student`.`semester_id` AS `semester_id`,count(0) AS `students_assessed`,round(avg(`per_student`.`subject_percentage`),2) AS `avg_percentage`,round(((sum((`per_student`.`subject_percentage` >= `pass_mark`.`min_pass`)) / count(0)) * 100),2) AS `pass_rate_percentage` from ((select `st`.`section_id` AS `section_id`,`e`.`subject_id` AS `subject_id`,`sub`.`subject_name` AS `subject_name`,`e`.`semester_id` AS `semester_id`,`m`.`student_id` AS `student_id`,avg(((`m`.`obtained_marks` / nullif(`e`.`total_marks`,0)) * 100)) AS `subject_percentage` from (((`marks` `m` join `exams` `e` on((`e`.`exam_id` = `m`.`exam_id`))) join `subjects` `sub` on(((`sub`.`subject_id` = `e`.`subject_id`) and (`sub`.`is_deleted` = 0)))) join `students` `st` on(((`st`.`student_id` = `m`.`student_id`) and (`st`.`is_deleted` = 0)))) where (`m`.`status` = 'Published') group by `st`.`section_id`,`e`.`subject_id`,`sub`.`subject_name`,`e`.`semester_id`,`m`.`student_id`) `per_student` join (select coalesce(min(`grades`.`min_percentage`),50) AS `min_pass` from `grades` where (`grades`.`grade_point` > 0)) `pass_mark`) group by `per_student`.`section_id`,`per_student`.`subject_id`,`per_student`.`subject_name`,`per_student`.`semester_id`;

DROP VIEW IF EXISTS `vw_exam_schedule_full`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_exam_schedule_full` AS select `e`.`exam_id` AS `exam_id`,`e`.`exam_name` AS `exam_name`,`e`.`exam_type` AS `exam_type`,`e`.`exam_date` AS `exam_date`,(to_days(`e`.`exam_date`) - to_days(curdate())) AS `days_until`,`e`.`total_marks` AS `total_marks`,`e`.`semester_id` AS `semester_id`,`sem`.`semester_number` AS `semester_number`,`sem`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`e`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`credit_hours` AS `credit_hours`,`e`.`classroom_id` AS `classroom_id`,`c`.`room_name` AS `room_name`,`c`.`building` AS `building`,`e`.`invigilator_id` AS `invigilator_id`,`emp`.`first_name` AS `invigilator_first_name`,`emp`.`last_name` AS `invigilator_last_name`,count(`m`.`mark_id`) AS `marks_entered`,sum((`m`.`status` = 'Published')) AS `marks_published` from (((((((`exams` `e` join `subjects` `sub` on(((`sub`.`subject_id` = `e`.`subject_id`) and (`sub`.`is_deleted` = 0)))) left join `semesters` `sem` on((`sem`.`semester_id` = `e`.`semester_id`))) left join `programs` `p` on((`p`.`program_id` = `sem`.`program_id`))) left join `classrooms` `c` on((`c`.`classroom_id` = `e`.`classroom_id`))) left join `teachers` `tch` on((`tch`.`teacher_id` = `e`.`invigilator_id`))) left join `employees` `emp` on((`emp`.`employee_id` = `tch`.`employee_id`))) left join `marks` `m` on((`m`.`exam_id` = `e`.`exam_id`))) group by `e`.`exam_id`,`e`.`exam_name`,`e`.`exam_type`,`e`.`exam_date`,`e`.`total_marks`,`e`.`semester_id`,`sem`.`semester_number`,`sem`.`program_id`,`p`.`program_name`,`e`.`subject_id`,`sub`.`subject_code`,`sub`.`subject_name`,`sub`.`credit_hours`,`e`.`classroom_id`,`c`.`room_name`,`c`.`building`,`e`.`invigilator_id`,`emp`.`first_name`,`emp`.`last_name`;

DROP VIEW IF EXISTS `vw_fee_collection_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_fee_collection_summary` AS select `fs`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`fs`.`semester_id` AS `semester_id`,`sem`.`semester_number` AS `semester_number`,count(distinct `v`.`fee_voucher_id`) AS `total_challans`,sum(`v`.`total_payable`) AS `total_payable`,coalesce(sum(`v`.`amount_paid`),0) AS `total_collected`,(sum(`v`.`total_payable`) - coalesce(sum(`v`.`amount_paid`),0)) AS `outstanding_balance`,round(((coalesce(sum(`v`.`amount_paid`),0) / nullif(sum(`v`.`total_payable`),0)) * 100),2) AS `collection_rate_percentage` from (((`fee_vouchers` `v` join `fee_structures` `fs` on((`fs`.`fee_structure_id` = `v`.`fee_structure_id`))) join `programs` `p` on((`p`.`program_id` = `fs`.`program_id`))) join `semesters` `sem` on((`sem`.`semester_id` = `fs`.`semester_id`))) group by `fs`.`program_id`,`p`.`program_name`,`fs`.`semester_id`,`sem`.`semester_number`;

DROP VIEW IF EXISTS `vw_fee_defaulters`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_fee_defaulters` AS select `v`.`fee_voucher_id` AS `fee_voucher_id`,`v`.`student_id` AS `student_id`,`st`.`registration_number` AS `registration_number`,`st`.`first_name` AS `first_name`,`st`.`last_name` AS `last_name`,`st`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`st`.`batch_id` AS `batch_id`,`b`.`batch_name` AS `batch_name`,`st`.`section_id` AS `section_id`,`sec`.`section_name` AS `section_name`,`v`.`semester_id` AS `semester_id`,`v`.`total_payable` AS `total_payable`,`v`.`amount_paid` AS `amount_paid`,`v`.`remaining_balance` AS `remaining_balance`,`v`.`due_date` AS `due_date`,`v`.`status` AS `status`,greatest((to_days(curdate()) - to_days(`v`.`due_date`)),0) AS `days_overdue` from ((((`fee_vouchers` `v` join `students` `st` on(((`st`.`student_id` = `v`.`student_id`) and (`st`.`is_deleted` = 0)))) left join `programs` `p` on((`p`.`program_id` = `st`.`program_id`))) left join `batches` `b` on((`b`.`batch_id` = `st`.`batch_id`))) left join `sections` `sec` on((`sec`.`section_id` = `st`.`section_id`))) where ((`v`.`status` = 'Overdue') or ((`v`.`due_date` < curdate()) and (`v`.`status` not in ('Paid','Cancelled'))));

DROP VIEW IF EXISTS `vw_leave_request_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_leave_request_summary` AS select `u`.`user_id` AS `user_id`,`emp`.`first_name` AS `first_name`,`emp`.`last_name` AS `last_name`,`emp`.`department_id` AS `department_id`,count(0) AS `total_requests`,sum((`lr`.`status` = 'Pending')) AS `pending_count`,sum((`lr`.`status` = 'Approved')) AS `approved_count`,sum((`lr`.`status` = 'Rejected')) AS `rejected_count`,sum(((`lr`.`status` = 'Approved') and (`lr`.`start_date` <= curdate()) and (`lr`.`end_date` >= curdate()))) AS `currently_on_leave` from ((`leave_requests` `lr` join `users` `u` on((`u`.`user_id` = `lr`.`user_id`))) left join `employees` `emp` on((`emp`.`user_id` = `u`.`user_id`))) group by `u`.`user_id`,`emp`.`first_name`,`emp`.`last_name`,`emp`.`department_id`;

DROP VIEW IF EXISTS `vw_overdue_book_issues`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_overdue_book_issues` AS select `bi`.`issue_id` AS `issue_id`,`bi`.`book_id` AS `book_id`,`b`.`title` AS `title`,`bi`.`borrower_user_id` AS `borrower_user_id`,`u`.`email` AS `borrower_email`,`bi`.`issue_date` AS `issue_date`,`bi`.`due_date` AS `due_date`,(to_days(curdate()) - to_days(`bi`.`due_date`)) AS `days_overdue`,`bi`.`fine_amount` AS `fine_amount` from ((`book_issues` `bi` join `books` `b` on((`b`.`book_id` = `bi`.`book_id`))) join `users` `u` on((`u`.`user_id` = `bi`.`borrower_user_id`))) where ((`bi`.`return_date` is null) and (`bi`.`due_date` < curdate()));

DROP VIEW IF EXISTS `vw_program_semester_catalog`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_program_semester_catalog` AS select `p`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`p`.`duration_semesters` AS `duration_semesters`,`d`.`department_id` AS `department_id`,`d`.`department_name` AS `department_name`,`s`.`semester_id` AS `semester_id`,`s`.`semester_number` AS `semester_number`,`s`.`start_date` AS `start_date`,`s`.`end_date` AS `end_date`,`s`.`is_archived` AS `is_archived`,`sub`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`credit_hours` AS `credit_hours`,`sub`.`prerequisite_subject_id` AS `prerequisite_subject_id`,`pre`.`subject_code` AS `prerequisite_subject_code`,`pre`.`subject_name` AS `prerequisite_subject_name` from ((((`programs` `p` join `departments` `d` on((`d`.`department_id` = `p`.`department_id`))) join `semesters` `s` on((`s`.`program_id` = `p`.`program_id`))) left join `subjects` `sub` on(((`sub`.`semester_id` = `s`.`semester_id`) and (`sub`.`is_deleted` = 0)))) left join `subjects` `pre` on((`pre`.`subject_id` = `sub`.`prerequisite_subject_id`))) where (`p`.`is_deleted` = 0);

DROP VIEW IF EXISTS `vw_semester_enrollment_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_semester_enrollment_summary` AS select `en`.`semester_id` AS `semester_id`,`s`.`semester_number` AS `semester_number`,`s`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`en`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`credit_hours` AS `credit_hours`,count(0) AS `enrolled_count`,sum((`en`.`status` = 'Active')) AS `active_count`,sum((`en`.`status` = 'Completed')) AS `completed_count`,sum((`en`.`status` = 'Dropped')) AS `dropped_count` from ((((`enrollments` `en` join `subjects` `sub` on(((`sub`.`subject_id` = `en`.`subject_id`) and (`sub`.`is_deleted` = 0)))) join `students` `st` on(((`st`.`student_id` = `en`.`student_id`) and (`st`.`is_deleted` = 0)))) join `semesters` `s` on((`s`.`semester_id` = `en`.`semester_id`))) left join `programs` `p` on((`p`.`program_id` = `s`.`program_id`))) group by `en`.`semester_id`,`s`.`semester_number`,`s`.`program_id`,`p`.`program_name`,`en`.`subject_id`,`sub`.`subject_code`,`sub`.`subject_name`,`sub`.`credit_hours`;

DROP VIEW IF EXISTS `vw_student_fee_status`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_student_fee_status` AS select `v`.`fee_voucher_id` AS `fee_voucher_id`,`v`.`student_id` AS `student_id`,`st`.`registration_number` AS `registration_number`,concat(`st`.`first_name`,' ',`st`.`last_name`) AS `full_name`,`st`.`program_id` AS `program_id`,`st`.`batch_id` AS `batch_id`,`st`.`section_id` AS `section_id`,`v`.`voucher_number` AS `voucher_number`,`v`.`semester_id` AS `semester_id`,`sem`.`semester_number` AS `semester_number`,`v`.`issue_date` AS `issue_date`,`v`.`due_date` AS `due_date`,`v`.`total_payable` AS `total_payable`,`v`.`amount_paid` AS `amount_paid`,`v`.`remaining_balance` AS `remaining_balance`,`v`.`status` AS `status`,coalesce(sum(`fp`.`amount_paid`),0) AS `payments_total`,coalesce(sum((case when (`fp`.`status` = 'Verified') then `fp`.`amount_paid` end)),0) AS `verified_total`,coalesce(sum((case when (`fp`.`status` = 'Pending') then `fp`.`amount_paid` end)),0) AS `pending_total`,coalesce(sum((case when (`fp`.`status` = 'Rejected') then `fp`.`amount_paid` end)),0) AS `rejected_total`,count(`fp`.`fee_payment_id`) AS `payment_count`,max(`fp`.`payment_date`) AS `last_payment_date`,(case when ((`v`.`due_date` < curdate()) and (`v`.`status` not in ('Paid','Cancelled'))) then (to_days(curdate()) - to_days(`v`.`due_date`)) else 0 end) AS `days_overdue` from (((`fee_vouchers` `v` join `students` `st` on(((`st`.`student_id` = `v`.`student_id`) and (`st`.`is_deleted` = 0)))) left join `semesters` `sem` on((`sem`.`semester_id` = `v`.`semester_id`))) left join `fee_payments` `fp` on((`fp`.`fee_voucher_id` = `v`.`fee_voucher_id`))) group by `v`.`fee_voucher_id`,`v`.`student_id`,`st`.`registration_number`,`st`.`first_name`,`st`.`last_name`,`st`.`program_id`,`st`.`batch_id`,`st`.`section_id`,`v`.`voucher_number`,`v`.`semester_id`,`sem`.`semester_number`,`v`.`issue_date`,`v`.`due_date`,`v`.`total_payable`,`v`.`amount_paid`,`v`.`remaining_balance`,`v`.`status`;

DROP VIEW IF EXISTS `vw_student_gpa_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_student_gpa_summary` AS select `r`.`result_id` AS `result_id`,`r`.`student_id` AS `student_id`,`st`.`registration_number` AS `registration_number`,`st`.`first_name` AS `first_name`,`st`.`last_name` AS `last_name`,`st`.`batch_id` AS `batch_id`,`st`.`section_id` AS `section_id`,`r`.`semester_id` AS `semester_id`,`s`.`semester_number` AS `semester_number`,`s`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`r`.`gpa` AS `gpa`,`r`.`cgpa` AS `cgpa`,`r`.`published_at` AS `published_at` from (((`results` `r` join `semesters` `s` on((`s`.`semester_id` = `r`.`semester_id`))) join `students` `st` on(((`st`.`student_id` = `r`.`student_id`) and (`st`.`is_deleted` = 0)))) left join `programs` `p` on((`p`.`program_id` = `s`.`program_id`))) where (`r`.`status` = 'Published');

DROP VIEW IF EXISTS `vw_student_profile_full`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_student_profile_full` AS select `st`.`student_id` AS `student_id`,`st`.`user_id` AS `user_id`,`u`.`email` AS `email`,`st`.`registration_number` AS `registration_number`,`st`.`first_name` AS `first_name`,`st`.`last_name` AS `last_name`,concat(`st`.`first_name`,' ',`st`.`last_name`) AS `full_name`,`st`.`gender` AS `gender`,`st`.`dob` AS `dob`,`st`.`phone` AS `phone`,`st`.`academic_status` AS `academic_status`,`st`.`program_id` AS `program_id`,`p`.`program_name` AS `program_name`,`p`.`duration_semesters` AS `duration_semesters`,`d`.`department_id` AS `department_id`,`d`.`department_name` AS `department_name`,`st`.`batch_id` AS `batch_id`,`b`.`batch_name` AS `batch_name`,`b`.`start_year` AS `start_year`,`b`.`end_year` AS `end_year`,`st`.`section_id` AS `section_id`,`sec`.`section_name` AS `section_name`,`st`.`current_semester_id` AS `current_semester_id`,`sem`.`semester_number` AS `current_semester_number`,`sem`.`start_date` AS `semester_start_date`,`sem`.`end_date` AS `semester_end_date` from ((((((`students` `st` left join `users` `u` on((`u`.`user_id` = `st`.`user_id`))) left join `programs` `p` on((`p`.`program_id` = `st`.`program_id`))) left join `departments` `d` on((`d`.`department_id` = `p`.`department_id`))) left join `batches` `b` on((`b`.`batch_id` = `st`.`batch_id`))) left join `sections` `sec` on((`sec`.`section_id` = `st`.`section_id`))) left join `semesters` `sem` on((`sem`.`semester_id` = `st`.`current_semester_id`))) where (`st`.`is_deleted` = 0);

DROP VIEW IF EXISTS `vw_student_subject_marks`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_student_subject_marks` AS select `m`.`mark_id` AS `mark_id`,`m`.`student_id` AS `student_id`,`e`.`exam_id` AS `exam_id`,`e`.`exam_name` AS `exam_name`,`e`.`exam_type` AS `exam_type`,`e`.`exam_date` AS `exam_date`,`e`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`credit_hours` AS `credit_hours`,`e`.`semester_id` AS `semester_id`,`sem`.`semester_number` AS `semester_number`,`m`.`obtained_marks` AS `obtained_marks`,`e`.`total_marks` AS `total_marks`,round(((`m`.`obtained_marks` / nullif(`e`.`total_marks`,0)) * 100),2) AS `percentage`,`g`.`grade_letter` AS `grade_letter`,`g`.`grade_point` AS `grade_point` from (((((`marks` `m` join `exams` `e` on((`e`.`exam_id` = `m`.`exam_id`))) join `subjects` `sub` on(((`sub`.`subject_id` = `e`.`subject_id`) and (`sub`.`is_deleted` = 0)))) join `students` `st` on(((`st`.`student_id` = `m`.`student_id`) and (`st`.`is_deleted` = 0)))) left join `semesters` `sem` on((`sem`.`semester_id` = `e`.`semester_id`))) left join `grades` `g` on((round(((`m`.`obtained_marks` / nullif(`e`.`total_marks`,0)) * 100),2) between `g`.`min_percentage` and `g`.`max_percentage`))) where (`m`.`status` = 'Published');

DROP VIEW IF EXISTS `vw_student_timetable`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_student_timetable` AS select `t`.`timetable_id` AS `timetable_id`,`t`.`section_id` AS `section_id`,`sec`.`section_name` AS `section_name`,`sec`.`batch_id` AS `batch_id`,`t`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`sub`.`credit_hours` AS `credit_hours`,`sub`.`semester_id` AS `semester_id`,`t`.`teacher_id` AS `teacher_id`,`emp`.`first_name` AS `teacher_first_name`,`emp`.`last_name` AS `teacher_last_name`,`t`.`classroom_id` AS `classroom_id`,`c`.`room_name` AS `room_name`,`c`.`building` AS `building`,`t`.`day_of_week` AS `day_of_week`,`t`.`start_time` AS `start_time`,`t`.`end_time` AS `end_time` from (((((`timetables` `t` join `subjects` `sub` on(((`sub`.`subject_id` = `t`.`subject_id`) and (`sub`.`is_deleted` = 0)))) left join `sections` `sec` on((`sec`.`section_id` = `t`.`section_id`))) left join `teachers` `tch` on((`tch`.`teacher_id` = `t`.`teacher_id`))) left join `employees` `emp` on((`emp`.`employee_id` = `tch`.`employee_id`))) left join `classrooms` `c` on((`c`.`classroom_id` = `t`.`classroom_id`))) order by `t`.`day_of_week`,`t`.`start_time`;

DROP VIEW IF EXISTS `vw_teacher_attendance_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_teacher_attendance_summary` AS select `teacher_attendance`.`employee_id` AS `employee_id`,count(0) AS `total_days`,sum((`teacher_attendance`.`status` = 'Present')) AS `present_count`,sum((`teacher_attendance`.`status` = 'Absent')) AS `absent_count`,sum((`teacher_attendance`.`status` = 'Late')) AS `late_count`,sum((`teacher_attendance`.`status` = 'Leave')) AS `leave_count`,round(((sum((`teacher_attendance`.`status` = 'Present')) / count(0)) * 100),2) AS `attendance_percentage` from `teacher_attendance` group by `teacher_attendance`.`employee_id`;

DROP VIEW IF EXISTS `vw_teacher_class_roster`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_teacher_class_roster` AS select distinct `t`.`teacher_id` AS `teacher_id`,`emp`.`employee_id` AS `employee_id`,`emp`.`first_name` AS `teacher_first_name`,`emp`.`last_name` AS `teacher_last_name`,`tt`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`tt`.`section_id` AS `section_id`,`sec`.`section_name` AS `section_name`,`sec`.`batch_id` AS `batch_id`,`b`.`batch_name` AS `batch_name`,`sub`.`semester_id` AS `semester_id`,`st`.`student_id` AS `student_id`,`st`.`registration_number` AS `registration_number`,`st`.`first_name` AS `student_first_name`,`st`.`last_name` AS `student_last_name`,`st`.`program_id` AS `program_id`,`en`.`status` AS `enrollment_status` from (((((((`timetables` `tt` join `teachers` `t` on(((`t`.`teacher_id` = `tt`.`teacher_id`) and (`t`.`is_deleted` = 0)))) join `employees` `emp` on(((`emp`.`employee_id` = `t`.`employee_id`) and (`emp`.`is_deleted` = 0)))) join `subjects` `sub` on(((`sub`.`subject_id` = `tt`.`subject_id`) and (`sub`.`is_deleted` = 0)))) join `sections` `sec` on(((`sec`.`section_id` = `tt`.`section_id`) and (`sec`.`is_deleted` = 0)))) left join `batches` `b` on((`b`.`batch_id` = `sec`.`batch_id`))) join `students` `st` on(((`st`.`section_id` = `tt`.`section_id`) and (`st`.`is_deleted` = 0)))) join `enrollments` `en` on(((`en`.`student_id` = `st`.`student_id`) and (`en`.`subject_id` = `tt`.`subject_id`))));

DROP VIEW IF EXISTS `vw_teacher_workload`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_teacher_workload` AS select `t`.`teacher_id` AS `teacher_id`,`emp`.`employee_id` AS `employee_id`,`emp`.`first_name` AS `first_name`,`emp`.`last_name` AS `last_name`,`emp`.`department_id` AS `department_id`,`d`.`department_name` AS `department_name`,count(0) AS `weekly_sessions`,count(distinct `tt`.`subject_id`) AS `distinct_subjects`,count(distinct `tt`.`section_id`) AS `distinct_sections`,round((sum(time_to_sec(timediff(`tt`.`end_time`,`tt`.`start_time`))) / 3600),2) AS `weekly_contact_hours` from (((`timetables` `tt` join `teachers` `t` on(((`t`.`teacher_id` = `tt`.`teacher_id`) and (`t`.`is_deleted` = 0)))) join `employees` `emp` on(((`emp`.`employee_id` = `t`.`employee_id`) and (`emp`.`is_deleted` = 0)))) left join `departments` `d` on((`d`.`department_id` = `emp`.`department_id`))) group by `t`.`teacher_id`,`emp`.`employee_id`,`emp`.`first_name`,`emp`.`last_name`,`emp`.`department_id`,`d`.`department_name`;

DROP VIEW IF EXISTS `vw_upcoming_exams`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `vw_upcoming_exams` AS select `e`.`exam_id` AS `exam_id`,`e`.`exam_name` AS `exam_name`,`e`.`exam_type` AS `exam_type`,`e`.`exam_date` AS `exam_date`,(to_days(`e`.`exam_date`) - to_days(curdate())) AS `days_until`,`e`.`total_marks` AS `total_marks`,`e`.`semester_id` AS `semester_id`,`sem`.`semester_number` AS `semester_number`,`sem`.`program_id` AS `program_id`,`e`.`subject_id` AS `subject_id`,`sub`.`subject_code` AS `subject_code`,`sub`.`subject_name` AS `subject_name`,`e`.`classroom_id` AS `classroom_id`,`c`.`room_name` AS `room_name`,`c`.`building` AS `building`,`e`.`invigilator_id` AS `invigilator_id`,`emp`.`first_name` AS `invigilator_first_name`,`emp`.`last_name` AS `invigilator_last_name` from (((((`exams` `e` join `subjects` `sub` on(((`sub`.`subject_id` = `e`.`subject_id`) and (`sub`.`is_deleted` = 0)))) left join `semesters` `sem` on((`sem`.`semester_id` = `e`.`semester_id`))) left join `classrooms` `c` on((`c`.`classroom_id` = `e`.`classroom_id`))) left join `teachers` `tch` on((`tch`.`teacher_id` = `e`.`invigilator_id`))) left join `employees` `emp` on((`emp`.`employee_id` = `tch`.`employee_id`))) where (`e`.`exam_date` >= curdate()) order by `e`.`exam_date`;


-- =====================================================================
-- Stored routines (4)
-- =====================================================================

-- Each routine is replayed under the sql_mode it was created with:
-- the bodies below are quoted the way that mode requires.
SET @saved_sql_mode = @@session.sql_mode;

SET SESSION sql_mode = 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
DROP PROCEDURE IF EXISTS `sp_calculate_book_fines`;
DELIMITER $$
CREATE PROCEDURE "sp_calculate_book_fines"()
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- PKR 10.00/day overdue - no late-fee policy is defined anywhere in
    -- the schema or docs, this is a placeholder rate and the only literal
    -- in this procedure, so it's a one-line change if the real policy
    -- differs.
    UPDATE book_issues
       SET fine_amount = DATEDIFF(CURDATE(), due_date) * 10.00
     WHERE return_date IS NULL
       AND due_date < CURDATE();

    COMMIT;
END$$
DELIMITER ;

SET SESSION sql_mode = 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
DROP PROCEDURE IF EXISTS `sp_mark_overdue_fees`;
DELIMITER $$
CREATE PROCEDURE "sp_mark_overdue_fees"()
BEGIN
                DECLARE EXIT HANDLER FOR SQLEXCEPTION
                BEGIN
                    ROLLBACK;
                    RESIGNAL;
                END;

                START TRANSACTION;

                UPDATE fee_vouchers
                   SET status = 'Overdue'
                 WHERE due_date < CURDATE()
                   AND status NOT IN ('Paid', 'Partial', 'Overdue', 'Cancelled');

                COMMIT;
            END$$
DELIMITER ;

SET SESSION sql_mode = 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
DROP PROCEDURE IF EXISTS `sp_publish_semester_results`;
DELIMITER $$
CREATE PROCEDURE "sp_publish_semester_results"(IN p_semester_id INT)
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
END$$
DELIMITER ;

SET SESSION sql_mode = 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
DROP PROCEDURE IF EXISTS `sp_record_payment`;
DELIMITER $$
CREATE PROCEDURE "sp_record_payment"(
                IN p_fee_voucher_id INT,
                IN p_amount_paid DECIMAL(12,2),
                IN p_payment_method VARCHAR(20),
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
                  FROM fee_vouchers
                 WHERE fee_voucher_id = p_fee_voucher_id
                 FOR UPDATE;

                IF v_total_payable IS NULL THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'sp_record_payment: fee_voucher_id not found';
                END IF;

                SET v_is_late = (v_due_date IS NOT NULL AND CURDATE() > v_due_date);

                -- receipt_number is UNIQUE and must be set at insert time, but
                -- the id is not known until afterwards; a collision-safe
                -- placeholder is rewritten once LAST_INSERT_ID() exists.
                INSERT INTO fee_payments
                    (fee_voucher_id, amount_paid, payment_method, payment_date,
                     is_late, receipt_number, recorded_by)
                VALUES
                    (p_fee_voucher_id, p_amount_paid, p_payment_method, CURDATE(),
                     v_is_late, SUBSTRING(REPLACE(UUID(), '-', ''), 1, 28), p_recorded_by);

                SET v_payment_id = LAST_INSERT_ID();

                UPDATE fee_payments
                   SET receipt_number = CONCAT('RCP-', DATE_FORMAT(CURDATE(), '%Y'), '-',
                                               LPAD(v_payment_id, 6, '0'))
                 WHERE fee_payment_id = v_payment_id;

                SELECT COALESCE(SUM(amount_paid), 0) INTO v_total_paid
                  FROM fee_payments
                 WHERE fee_voucher_id = p_fee_voucher_id;

                SET v_new_status = CASE
                    WHEN v_total_payable > 0 AND v_total_paid >= v_total_payable THEN 'Paid'
                    WHEN v_total_paid > 0 THEN 'Partial'
                    WHEN v_due_date IS NOT NULL AND v_due_date < CURDATE() THEN 'Overdue'
                    ELSE 'Unpaid'
                END;

                UPDATE fee_vouchers
                   SET amount_paid = v_total_paid,
                       remaining_balance = v_total_payable - v_total_paid,
                       status = v_new_status
                 WHERE fee_voucher_id = p_fee_voucher_id;

                COMMIT;

                SELECT v_payment_id AS fee_payment_id,
                       v_new_status AS new_status,
                       v_total_paid AS total_paid,
                       (v_total_payable - v_total_paid) AS remaining_balance;
            END$$
DELIMITER ;

SET SESSION sql_mode = @saved_sql_mode;

SET FOREIGN_KEY_CHECKS = 1;
