-- =====================================================================
-- AIMS - Constraints (foreign keys, unique keys, checks)
-- Generated from the LIVE database (aims_db) on 2026-08-27T15:31:42.526Z
-- Source of truth: the deployed schema, not the migration history.
-- Do not hand-edit; re-run `node scripts/generate_schema_from_live.js` instead.
-- =====================================================================

-- Run AFTER schema.sql. Foreign keys are kept out of the CREATE TABLE
-- statements so tables can be created in any order.

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Foreign keys (111)
-- ---------------------------------------------------------------------

ALTER TABLE `ai_predictions`
  ADD CONSTRAINT `ai_predictions_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_predictions`
  ADD CONSTRAINT `ai_predictions_ibfk_2` FOREIGN KEY (`model_id`) REFERENCES `prediction_models` (`model_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `analytics_dashboard_cards`
  ADD CONSTRAINT `analytics_dashboard_cards_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

ALTER TABLE `analytics_dashboard_cards`
  ADD CONSTRAINT `analytics_dashboard_cards_ibfk_2` FOREIGN KEY (`saved_query_id`) REFERENCES `saved_analytics_queries` (`saved_query_id`) ON DELETE CASCADE;

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_announcement` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`announcement_id`) ON DELETE CASCADE;

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`);

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`program_id`);

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`);

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_section` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`);

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_sem` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`);

ALTER TABLE `announcement_targets`
  ADD CONSTRAINT `fk_at_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `announcements`
  ADD CONSTRAINT `announcements_ibfk_1` FOREIGN KEY (`posted_by`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `assistant_conversations`
  ADD CONSTRAINT `assistant_conversations_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

ALTER TABLE `assistant_conversations`
  ADD CONSTRAINT `assistant_conversations_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`);

ALTER TABLE `assistant_messages`
  ADD CONSTRAINT `assistant_messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations` (`conversation_id`) ON DELETE CASCADE;

ALTER TABLE `assistant_query_log`
  ADD CONSTRAINT `assistant_query_log_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations` (`conversation_id`) ON DELETE SET NULL;

ALTER TABLE `assistant_query_log`
  ADD CONSTRAINT `assistant_query_log_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`);

ALTER TABLE `attendance`
  ADD CONSTRAINT `attendance_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `attendance`
  ADD CONSTRAINT `attendance_ibfk_2` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `attendance`
  ADD CONSTRAINT `attendance_ibfk_3` FOREIGN KEY (`timetable_id`) REFERENCES `timetables` (`timetable_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `attendance`
  ADD CONSTRAINT `attendance_ibfk_4` FOREIGN KEY (`marked_by`) REFERENCES `teachers` (`teacher_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `audit_logs`
  ADD CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `batches`
  ADD CONSTRAINT `batches_ibfk_1` FOREIGN KEY (`program_id`) REFERENCES `programs` (`program_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `book_issues`
  ADD CONSTRAINT `book_issues_ibfk_1` FOREIGN KEY (`book_id`) REFERENCES `books` (`book_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `book_issues`
  ADD CONSTRAINT `book_issues_ibfk_2` FOREIGN KEY (`borrower_user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `course_offerings`
  ADD CONSTRAINT `course_offerings_ibfk_1` FOREIGN KEY (`term_id`) REFERENCES `academic_terms` (`term_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `course_offerings`
  ADD CONSTRAINT `course_offerings_ibfk_2` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `course_offerings`
  ADD CONSTRAINT `course_offerings_ibfk_3` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `course_offerings`
  ADD CONSTRAINT `course_offerings_ibfk_4` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `dashboard_widgets`
  ADD CONSTRAINT `dashboard_widgets_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `departments`
  ADD CONSTRAINT `departments_ibfk_1` FOREIGN KEY (`head_employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `employee_documents`
  ADD CONSTRAINT `employee_documents_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employees`
  ADD CONSTRAINT `employees_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employees`
  ADD CONSTRAINT `employees_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_ibfk_2` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_ibfk_3` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_ibfk_4` FOREIGN KEY (`term_id`) REFERENCES `academic_terms` (`term_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_ibfk_5` FOREIGN KEY (`term_id`) REFERENCES `academic_terms` (`term_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_offering_id_foreign_idx` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`offering_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `enrollments`
  ADD CONSTRAINT `enrollments_term_id_foreign_idx` FOREIGN KEY (`term_id`) REFERENCES `academic_terms` (`term_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `exams`
  ADD CONSTRAINT `exams_ibfk_1` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `exams`
  ADD CONSTRAINT `exams_ibfk_2` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `exams`
  ADD CONSTRAINT `exams_ibfk_3` FOREIGN KEY (`classroom_id`) REFERENCES `classrooms` (`classroom_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `exams`
  ADD CONSTRAINT `exams_ibfk_4` FOREIGN KEY (`invigilator_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `fee_payments`
  ADD CONSTRAINT `fee_payments_ibfk_1` FOREIGN KEY (`fee_voucher_id`) REFERENCES `fee_vouchers` (`fee_voucher_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `fee_payments`
  ADD CONSTRAINT `fee_payments_ibfk_2` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `fee_payments`
  ADD CONSTRAINT `fee_payments_verified_by_foreign_idx` FOREIGN KEY (`verified_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `fee_structures`
  ADD CONSTRAINT `fee_structures_ibfk_1` FOREIGN KEY (`program_id`) REFERENCES `programs` (`program_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `fee_structures`
  ADD CONSTRAINT `fee_structures_ibfk_2` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `fee_vouchers`
  ADD CONSTRAINT `fee_vouchers_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `fee_vouchers`
  ADD CONSTRAINT `fee_vouchers_ibfk_2` FOREIGN KEY (`fee_structure_id`) REFERENCES `fee_structures` (`fee_structure_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `fee_vouchers`
  ADD CONSTRAINT `fee_vouchers_ibfk_3` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `gpa`
  ADD CONSTRAINT `fk_gpa_semester` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `gpa`
  ADD CONSTRAINT `fk_gpa_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `leave_requests`
  ADD CONSTRAINT `leave_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `leave_requests`
  ADD CONSTRAINT `leave_requests_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `marks`
  ADD CONSTRAINT `marks_ibfk_1` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`exam_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `marks`
  ADD CONSTRAINT `marks_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `marks`
  ADD CONSTRAINT `marks_ibfk_3` FOREIGN KEY (`entered_by`) REFERENCES `teachers` (`teacher_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `marks`
  ADD CONSTRAINT `marks_ibfk_4` FOREIGN KEY (`verified_by`) REFERENCES `teachers` (`teacher_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `meeting_requests`
  ADD CONSTRAINT `meeting_requests_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `parents` (`parent_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `meeting_requests`
  ADD CONSTRAINT `meeting_requests_ibfk_2` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `parents`
  ADD CONSTRAINT `parents_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payroll`
  ADD CONSTRAINT `payroll_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `performance_evaluations`
  ADD CONSTRAINT `performance_evaluations_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `performance_evaluations`
  ADD CONSTRAINT `performance_evaluations_ibfk_2` FOREIGN KEY (`evaluated_by`) REFERENCES `employees` (`employee_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `prediction_history`
  ADD CONSTRAINT `prediction_history_ibfk_1` FOREIGN KEY (`prediction_id`) REFERENCES `ai_predictions` (`prediction_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `prediction_history`
  ADD CONSTRAINT `prediction_history_ibfk_2` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `programs`
  ADD CONSTRAINT `programs_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reports`
  ADD CONSTRAINT `reports_ibfk_1` FOREIGN KEY (`generated_by`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `results`
  ADD CONSTRAINT `results_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `results`
  ADD CONSTRAINT `results_ibfk_2` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `role_permissions`
  ADD CONSTRAINT `role_permissions_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `role_permissions`
  ADD CONSTRAINT `role_permissions_ibfk_2` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`permission_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `saved_analytics_queries`
  ADD CONSTRAINT `saved_analytics_queries_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

ALTER TABLE `scholarships`
  ADD CONSTRAINT `scholarships_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `scholarships`
  ADD CONSTRAINT `scholarships_ibfk_2` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `scholarships`
  ADD CONSTRAINT `scholarships_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `employees` (`employee_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `sections`
  ADD CONSTRAINT `sections_ibfk_1` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `semesters`
  ADD CONSTRAINT `semesters_ibfk_1` FOREIGN KEY (`program_id`) REFERENCES `programs` (`program_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `student_documents`
  ADD CONSTRAINT `student_documents_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `student_guardians`
  ADD CONSTRAINT `student_guardians_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `students` (`student_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `student_guardians`
  ADD CONSTRAINT `student_guardians_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `parents` (`parent_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `students`
  ADD CONSTRAINT `students_current_semester_id_foreign_idx` FOREIGN KEY (`current_semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `students`
  ADD CONSTRAINT `students_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `students`
  ADD CONSTRAINT `students_ibfk_2` FOREIGN KEY (`program_id`) REFERENCES `programs` (`program_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `students`
  ADD CONSTRAINT `students_ibfk_3` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `students`
  ADD CONSTRAINT `students_ibfk_4` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `subjects`
  ADD CONSTRAINT `subjects_ibfk_1` FOREIGN KEY (`semester_id`) REFERENCES `semesters` (`semester_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `subjects`
  ADD CONSTRAINT `subjects_ibfk_2` FOREIGN KEY (`prerequisite_subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `teacher_assignments`
  ADD CONSTRAINT `fk_ta_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teacher_assignments`
  ADD CONSTRAINT `fk_ta_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teacher_assignments`
  ADD CONSTRAINT `fk_ta_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teacher_attendance`
  ADD CONSTRAINT `teacher_attendance_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `teacher_profiles`
  ADD CONSTRAINT `fk_tp_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teacher_schedules`
  ADD CONSTRAINT `fk_ts_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teacher_schedules`
  ADD CONSTRAINT `fk_ts_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `teacher_subjects`
  ADD CONSTRAINT `teacher_subjects_ibfk_1` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `teacher_subjects`
  ADD CONSTRAINT `teacher_subjects_ibfk_2` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `teachers`
  ADD CONSTRAINT `teachers_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`employee_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_ibfk_1` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`subject_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_ibfk_2` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_ibfk_3` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`teacher_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_ibfk_4` FOREIGN KEY (`classroom_id`) REFERENCES `classrooms` (`classroom_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_ibfk_5` FOREIGN KEY (`term_id`) REFERENCES `academic_terms` (`term_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_offering_id_foreign_idx` FOREIGN KEY (`offering_id`) REFERENCES `course_offerings` (`offering_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timetables`
  ADD CONSTRAINT `timetables_term_id_foreign_idx` FOREIGN KEY (`term_id`) REFERENCES `academic_terms` (`term_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `user_preferences`
  ADD CONSTRAINT `user_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Unique constraints (32) - declared inline in schema.sql,
-- listed here for reference.
-- ---------------------------------------------------------------------

--   SequelizeData.name (name)
--   academic_terms.term_code (term_code)
--   academic_terms.uq_one_active_term (active_flag)
--   attendance.uq_attendance_once (student_id,timetable_id,att_date)
--   books.isbn (isbn)
--   classrooms.uq_room_per_building (room_name,building)
--   course_offerings.uq_offering_term_section_subject (term_id,section_id,subject_id)
--   departments.department_name (department_name)
--   employees.employee_code (employee_code)
--   employees.user_id (user_id)
--   enrollments.uq_enrollment_once_per_term (student_id,subject_id,semester_id,term_id)
--   fee_payments.receipt_number (receipt_number)
--   fee_vouchers.voucher_number (voucher_number)
--   grades.grade_letter (grade_letter)
--   marks.uq_marks_once (exam_id,student_id)
--   parents.user_id (user_id)
--   payroll.uq_payroll_once (employee_id,month)
--   permissions.permission_name (permission_name)
--   prediction_models.uq_model_version (model_name,version)
--   programs.uq_program_per_department (department_id,program_name)
--   results.uq_result_once (student_id,semester_id)
--   roles.role_name (role_name)
--   saved_analytics_queries.uq_saved_analytics_user_name (user_id,name)
--   students.cnic_bform (cnic_bform)
--   students.registration_number (registration_number)
--   students.user_id (user_id)
--   subjects.subject_code (subject_code)
--   teacher_attendance.uq_teacher_attendance_once (employee_id,att_date)
--   timetables.uq_timetable_classroom_slot (term_id,classroom_id,day_of_week,start_time)
--   timetables.uq_timetable_section_slot (term_id,section_id,day_of_week,start_time)
--   timetables.uq_timetable_teacher_slot (term_id,teacher_id,day_of_week,start_time)
--   users.email (email)

-- ---------------------------------------------------------------------
-- Check constraints (10) - SHOW CREATE TABLE already emits
-- these inline, so schema.sql creates them. Re-adding them here would
-- fail with "Duplicate check constraint name". Listed for reference.
-- ---------------------------------------------------------------------

--   ai_predictions.chk_prediction_confidence
--     CHECK ((`confidence_score` is null) or ((`confidence_score` >= 0) and (`confidence_score` <= 100)))
--   analytics_dashboard_cards.ck_analytics_cards_one_source
--     CHECK (((`saved_query_id` is not null) and (`builtin_key` is null)) or ((`saved_query_id` is null) and (`builtin_key` is not null)))
--   books.chk_books_available_copies
--     CHECK ((`available_copies` >= 0) and (`available_copies` <= `total_copies`))
--   books.chk_books_total_copies
--     CHECK (`total_copies` >= 0)
--   exams.chk_exams_total_marks
--     CHECK (`total_marks` > 0)
--   marks.chk_marks_obtained
--     CHECK (`obtained_marks` >= 0)
--   prediction_history.chk_prediction_history_confidence
--     CHECK ((`confidence_score` is null) or ((`confidence_score` >= 0) and (`confidence_score` <= 100)))
--   prediction_models.chk_model_accuracy
--     CHECK ((`accuracy_score` is null) or ((`accuracy_score` >= 0) and (`accuracy_score` <= 100)))
--   scholarships.chk_scholarship_discount
--     CHECK ((`discount_percentage` > 0) and (`discount_percentage` <= 100))
--   users.chk_users_failed_logins
--     CHECK (`failed_login_attempts` >= 0)

SET FOREIGN_KEY_CHECKS = 1;
