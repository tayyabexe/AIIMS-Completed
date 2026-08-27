/**
 * ROOT-CAUSE REBUILD
 *
 * The two "blockers" (sections with no timetable, semesters with no exams) were
 * symptoms of a hollow curriculum:
 *   - programs declare duration_semesters = 8, but only 8 semester rows existed
 *     across all 5 programs (should be 40)
 *   - every semester carried exactly ONE subject (should be ~5)
 *   - sections 1-4 mixed students from two different semesters, so no single
 *     weekly timetable could serve them
 *   - 1,926 attendance rows sat outside the student's own semester term
 *
 * This script fixes the cause, not the symptom:
 *   1. full 40-semester calendar, every active term anchored to Spring 2024
 *   2. real 5-subject curriculum for all 40 semesters (200 subjects)
 *   3. every section pinned to exactly ONE semester
 *   4. full weekly timetable per section, department-matched teachers, no clashes
 *   5. exams / enrollments / attendance / marks all regenerated strictly inside
 *      the owning semester's date range
 *   6. finance rebuilt against real per-program fee structures
 *   7. constant-value columns given realistic variety
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let _seed = 424242;
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const shuffle = (a0) => { const a = [...a0]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
const d2 = (n) => String(n).padStart(2, '0');
const ds = (y, m, d) => `${y}-${d2(m)}-${d2(d)}`;
const toDate = (s) => new Date(s + 'T00:00:00Z');
const fmt = (dt) => `${dt.getUTCFullYear()}-${d2(dt.getUTCMonth() + 1)}-${d2(dt.getUTCDate())}`;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function ins(conn, table, cols, rows, bs = 1000) {
  if (!rows.length) return 0;
  let total = 0;
  const cl = cols.map((c) => '`' + c + '`').join(',');
  for (let i = 0; i < rows.length; i += bs) {
    const ch = rows.slice(i, i + bs);
    const ph = ch.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
    const flat = [];
    for (const r of ch) for (const c of cols) flat.push(r[c]);
    const [res] = await conn.query(`INSERT INTO \`${table}\` (${cl}) VALUES ${ph}`, flat);
    total += res.affectedRows;
  }
  return total;
}

// term calendar: offset 0 == Spring 2024 (the "current" term for every active semester)
function term(offset) {
  const even = ((offset % 2) + 2) % 2 === 0;
  if (even) {
    const y = 2024 + offset / 2;
    return { start: ds(y, 2, 1), end: ds(y, 6, 30), archived: offset < 0 };
  }
  const y = 2024 + (offset - 1) / 2;
  return { start: ds(y, 9, 1), end: ds(y + 1, 1, 31), archived: offset < 0 };
}

// 8-semester curriculum per program. Each entry is that semester's 5 subjects.
const CURRICULA = {
  1: [ // BS Computer Science
    ['Programming Fundamentals', 'Applied Physics', 'Calculus I', 'English Composition', 'Islamic Studies'],
    ['Object Oriented Programming', 'Discrete Structures', 'Calculus II', 'Communication Skills', 'Pakistan Studies'],
    ['Data Structures & Algorithms', 'Digital Logic Design', 'Linear Algebra', 'Probability & Statistics', 'Technical Writing'],
    ['Database Systems', 'Operating Systems', 'Computer Organization', 'Software Engineering', 'Numerical Methods'],
    ['Computer Networks', 'Design & Analysis of Algorithms', 'Web Technologies', 'Theory of Automata', 'Professional Practices'],
    ['Artificial Intelligence', 'Compiler Construction', 'Information Security', 'Mobile Application Development', 'Human Computer Interaction'],
    ['Machine Learning', 'Distributed Systems', 'Cloud Computing', 'Final Year Project I', 'Entrepreneurship'],
    ['Deep Learning', 'Big Data Analytics', 'Cyber Security', 'Final Year Project II', 'Technology Management'],
  ],
  2: [ // BS Data Science
    ['Introduction to Data Science', 'Programming for Data Science', 'Calculus I', 'English Composition', 'Islamic Studies'],
    ['Statistics for Data Science', 'Object Oriented Programming', 'Linear Algebra', 'Communication Skills', 'Pakistan Studies'],
    ['Data Structures', 'Probability Theory', 'Database Systems', 'Discrete Mathematics', 'Technical Writing'],
    ['Data Mining', 'Machine Learning Fundamentals', 'Data Visualization', 'Regression Analysis', 'Research Methods'],
    ['Deep Learning', 'Big Data Technologies', 'Natural Language Processing', 'Time Series Analysis', 'Cloud Computing'],
    ['Computer Vision', 'Reinforcement Learning', 'Data Engineering', 'Bayesian Statistics', 'Professional Practices'],
    ['AI Ethics & Governance', 'Advanced Analytics', 'Optimization Techniques', 'Final Year Project I', 'Entrepreneurship'],
    ['MLOps', 'Business Intelligence', 'Data Warehousing', 'Final Year Project II', 'Technology Management'],
  ],
  3: [ // BS Electrical Engineering
    ['Applied Physics', 'Linear Circuit Analysis', 'Calculus I', 'English Composition', 'Islamic Studies'],
    ['Electronic Devices', 'Programming Fundamentals', 'Calculus II', 'Communication Skills', 'Pakistan Studies'],
    ['Digital Logic Design', 'Signals and Systems', 'Differential Equations', 'Electrical Machines', 'Technical Writing'],
    ['Circuit Analysis', 'Electromagnetic Field Theory', 'Microprocessor Systems', 'Control Systems', 'Numerical Methods'],
    ['Power Systems Analysis', 'Communication Systems', 'Digital Signal Processing', 'Instrumentation & Measurement', 'Professional Practices'],
    ['Power Electronics', 'Antenna & Wave Propagation', 'Embedded Systems', 'Renewable Energy Systems', 'Engineering Economics'],
    ['High Voltage Engineering', 'Industrial Automation', 'Wireless Communication', 'Final Year Project I', 'Entrepreneurship'],
    ['Smart Grid Technology', 'VLSI Design', 'Power Distribution', 'Final Year Project II', 'Engineering Management'],
  ],
  4: [ // BBA Honors
    ['Introduction to Business', 'Financial Accounting', 'Business Mathematics', 'English Composition', 'Islamic Studies'],
    ['Principles of Management', 'Microeconomics', 'Business Communication', 'Cost Accounting', 'Pakistan Studies'],
    ['Macroeconomics', 'Marketing Management', 'Business Statistics', 'Organizational Behavior', 'Technical Writing'],
    ['Financial Management', 'Human Resource Management', 'Business Law', 'Operations Management', 'Research Methods'],
    ['Investment Analysis', 'Consumer Behavior', 'Supply Chain Management', 'Taxation Management', 'Professional Practices'],
    ['Strategic Management', 'International Business', 'Brand Management', 'Corporate Finance', 'Entrepreneurship'],
    ['Project Management', 'Business Analytics', 'Islamic Banking & Finance', 'Final Year Project I', 'Leadership Development'],
    ['Corporate Governance', 'Risk Management', 'E-Commerce Management', 'Final Year Project II', 'Business Ethics'],
  ],
  5: [ // BS Software Engineering
    ['Programming Fundamentals', 'Applied Physics', 'Calculus I', 'English Composition', 'Islamic Studies'],
    ['Software Requirement Engineering', 'Object Oriented Programming', 'Discrete Structures', 'Communication Skills', 'Pakistan Studies'],
    ['Data Structures', 'Software Design & Architecture', 'Database Systems', 'Linear Algebra', 'Technical Writing'],
    ['Software Construction', 'Operating Systems', 'Web Engineering', 'Probability & Statistics', 'Numerical Methods'],
    ['Software Quality Assurance', 'Human Computer Interaction', 'Computer Networks', 'Software Project Management', 'Professional Practices'],
    ['Software Testing', 'Mobile Application Development', 'Agile Development', 'Information Security', 'Engineering Economics'],
    ['DevOps Engineering', 'Cloud Native Development', 'Software Metrics', 'Final Year Project I', 'Entrepreneurship'],
    ['Microservices Architecture', 'Enterprise Systems', 'Software Maintenance', 'Final Year Project II', 'Engineering Management'],
  ],
};
const PREFIX = { 1: 'CS', 2: 'DS', 3: 'EE', 4: 'BBA', 5: 'SE' };

const SPEC_BY_DEPT = {
  1: ['Artificial Intelligence & Machine Learning', 'Database Systems', 'Computer Networks', 'Algorithms & Theory', 'Cyber Security'],
  2: ['Power Systems', 'Electronics & Circuits', 'Signal Processing', 'Control Systems', 'Telecommunications'],
  3: ['Marketing', 'Finance & Accounting', 'Human Resource Management', 'Operations Management', 'Entrepreneurship'],
  4: ['Software Architecture', 'Software Quality Assurance', 'Web & Mobile Engineering', 'DevOps & Cloud', 'Requirements Engineering'],
};

(async () => {
  const t0 = Date.now();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000,
  });
  const log = (t, n) => console.log(`  ${t.padEnd(30)} ${String(n).padStart(7)}`);

  try {
    // ============================================== 1. SEMESTER CALENDAR
    console.log('\nSTEP 1 - Full semester calendar (5 programs x 8)\n');
    const [progs] = await conn.query('SELECT program_id,duration_semesters FROM programs ORDER BY program_id');
    const [semExisting] = await conn.query('SELECT semester_id,program_id,semester_number FROM semesters');
    const semKey = new Map(semExisting.map((s) => [`${s.program_id}|${s.semester_number}`, s.semester_id]));

    // which semester_number is "current" for each program (where its students sit)
    const ACTIVE_NUM = { 1: 4, 2: 4, 3: 4, 4: 2, 5: 2 };

    const newSems = [];
    for (const p of progs) {
      for (let n = 1; n <= p.duration_semesters; n++) {
        if (semKey.has(`${p.program_id}|${n}`)) continue;
        const t = term(n - ACTIVE_NUM[p.program_id]);
        newSems.push({ program_id: p.program_id, semester_number: n, start_date: t.start, end_date: t.end, is_archived: t.archived ? 1 : 0 });
      }
    }
    log('semesters added', await ins(conn, 'semesters', ['program_id', 'semester_number', 'start_date', 'end_date', 'is_archived'], newSems));

    // realign EXISTING semester dates onto the same calendar
    for (const s of semExisting) {
      const t = term(s.semester_number - ACTIVE_NUM[s.program_id]);
      await conn.query('UPDATE semesters SET start_date=?,end_date=?,is_archived=? WHERE semester_id=?',
        [t.start, t.end, t.archived ? 1 : 0, s.semester_id]);
    }
    console.log('  existing semester dates realigned to the same calendar');

    const [allSems] = await conn.query('SELECT semester_id,program_id,semester_number,start_date,end_date FROM semesters');
    const semByPN = new Map(allSems.map((s) => [`${s.program_id}|${s.semester_number}`, s]));
    const semById = new Map(allSems.map((s) => [s.semester_id, s]));

    // ============================================== 2. SUBJECT CURRICULA
    console.log('\nSTEP 2 - Real 5-subject curriculum for every semester\n');
    const [subjExisting] = await conn.query('SELECT subject_id,subject_code,subject_name,semester_id FROM subjects');
    const existingBySem = {};
    for (const s of subjExisting) (existingBySem[s.semester_id] ||= []).push(s);
    const usedCodes = new Set(subjExisting.map((s) => s.subject_code));

    const newSubs = [];
    for (const [pid, sems] of Object.entries(CURRICULA)) {
      for (let n = 1; n <= 8; n++) {
        const sem = semByPN.get(`${pid}|${n}`);
        if (!sem) continue;
        const have = new Set((existingBySem[sem.semester_id] || []).map((s) => s.subject_name));
        sems[n - 1].forEach((name, idx) => {
          if (have.has(name)) return;                       // already present, keep it
          let code = `${PREFIX[pid]}-${n}${d2(idx + 1)}`;
          let k = 0;
          while (usedCodes.has(code)) code = `${PREFIX[pid]}-${n}${d2(idx + 1)}${String.fromCharCode(65 + k++)}`;
          usedCodes.add(code);
          newSubs.push({
            subject_code: code, subject_name: name,
            credit_hours: /Project|Lab/.test(name) ? 3 : (idx < 3 ? 3 : 2),
            semester_id: sem.semester_id, prerequisite_subject_id: null, is_deleted: 0,
          });
        });
      }
    }
    log('subjects added', await ins(conn, 'subjects',
      ['subject_code', 'subject_name', 'credit_hours', 'semester_id', 'prerequisite_subject_id', 'is_deleted'], newSubs));

    // link prerequisites: same-named-family subject in the previous semester of the program
    const [allSubs] = await conn.query(
      'SELECT su.subject_id,su.subject_code,su.subject_name,su.semester_id,se.program_id,se.semester_number FROM subjects su JOIN semesters se ON se.semester_id=su.semester_id');
    const subsBySem = {};
    for (const s of allSubs) (subsBySem[s.semester_id] ||= []).push(s);
    let preqCount = 0;
    const CHAIN = [['Calculus II', 'Calculus I'], ['Object Oriented Programming', 'Programming Fundamentals'],
      ['Data Structures & Algorithms', 'Object Oriented Programming'], ['Data Structures', 'Object Oriented Programming'],
      ['Design & Analysis of Algorithms', 'Data Structures & Algorithms'], ['Deep Learning', 'Machine Learning'],
      ['Final Year Project II', 'Final Year Project I'], ['Software Testing', 'Software Quality Assurance'],
      ['Corporate Finance', 'Financial Management'], ['Macroeconomics', 'Microeconomics'],
      ['Power Electronics', 'Power Systems Analysis'], ['Circuit Analysis', 'Linear Circuit Analysis']];
    for (const s of allSubs) {
      const rule = CHAIN.find((c) => c[0] === s.subject_name);
      if (!rule) continue;
      const prior = allSubs.find((x) => x.subject_name === rule[1] && x.program_id === s.program_id && x.semester_number < s.semester_number);
      if (prior) { await conn.query('UPDATE subjects SET prerequisite_subject_id=? WHERE subject_id=?', [prior.subject_id, s.subject_id]); preqCount++; }
    }
    log('prerequisites linked', preqCount);

    // ============================================== 3. PIN SECTIONS TO ONE SEMESTER
    console.log('\nSTEP 3 - Pin every section to exactly ONE semester\n');
    const [sections] = await conn.query(
      'SELECT sec.section_id,sec.batch_id,b.program_id FROM sections sec JOIN batches b ON b.batch_id=sec.batch_id');
    const sectionSemester = {};
    for (const sec of sections) {
      sectionSemester[sec.section_id] = semByPN.get(`${sec.program_id}|${ACTIVE_NUM[sec.program_id]}`).semester_id;
    }
    for (const [secId, semId] of Object.entries(sectionSemester)) {
      await conn.query('UPDATE students SET current_semester_id=? WHERE section_id=?', [semId, secId]);
    }
    console.log('  students realigned:', JSON.stringify(sectionSemester));

    // results + scholarships must follow the student's semester
    await conn.query('UPDATE results r JOIN students s ON s.student_id=r.student_id SET r.semester_id=s.current_semester_id');
    await conn.query('UPDATE scholarships sc JOIN students s ON s.student_id=sc.student_id SET sc.semester_id=s.current_semester_id');
    console.log('  results + scholarships realigned to match');

    const [students] = await conn.query(
      'SELECT student_id,section_id,program_id,batch_id,current_semester_id FROM students');
    const activeSemIds = [...new Set(Object.values(sectionSemester))];

    // ============================================== 4. TIMETABLES
    console.log('\nSTEP 4 - Full weekly timetable per section\n');
    const [teachers] = await conn.query(
      'SELECT t.teacher_id,e.department_id FROM teachers t JOIN employees e ON e.employee_id=t.employee_id');
    const [classrooms] = await conn.query('SELECT classroom_id FROM classrooms');
    const roomIds = classrooms.map((c) => c.classroom_id);
    const PROG_DEPT = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };
    const teachersByDept = {};
    for (const t of teachers) (teachersByDept[t.department_id] ||= []).push(t.teacher_id);
    const allTeacherIds = teachers.map((t) => t.teacher_id);

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE attendance');
    await conn.query('TRUNCATE TABLE marks');
    await conn.query('TRUNCATE TABLE exams');
    await conn.query('TRUNCATE TABLE timetables');
    await conn.query('TRUNCATE TABLE enrollments');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    // The institute's period grid, imported rather than restated. This used to
    // be a literal ending 14:00-15:30, which drifted from the grid the API and
    // the portals use: generated rows landed in a 4th period the application
    // did not recognise, so a subject scheduled there showed up at a time no
    // slot column matched. Single source of truth: backend/src/config/timetableSlots.js
    const SLOTS = require('../../backend/src/config/timetableSlots')
      .SLOTS.map((s) => [s.start_time, s.end_time]);
    const busyT = new Set(), busyR = new Set(), busyS = new Set();
    const ttRows = [];
    for (const sec of sections) {
      const semId = sectionSemester[sec.section_id];
      const subs = (subsBySem[semId] || []);
      const pool = teachersByDept[PROG_DEPT[sec.program_id]] || allTeacherIds;
      for (const su of subs) {
        let done = false;
        for (const day of shuffle(DAYS)) {
          for (const [st, en] of SLOTS) {
            if (busyS.has(`${sec.section_id}|${day}|${st}`)) continue;       // section can't be in 2 classes at once
            const teacher = pool.find((t) => !busyT.has(`${t}|${day}|${st}`))
              ?? allTeacherIds.find((t) => !busyT.has(`${t}|${day}|${st}`));
            if (!teacher) continue;
            const room = roomIds.find((r) => !busyR.has(`${r}|${day}|${st}`));
            if (!room) continue;
            busyT.add(`${teacher}|${day}|${st}`); busyR.add(`${room}|${day}|${st}`);
            busyS.add(`${sec.section_id}|${day}|${st}`);
            ttRows.push({ subject_id: su.subject_id, section_id: sec.section_id, teacher_id: teacher, classroom_id: room, day_of_week: day, start_time: st, end_time: en });
            done = true; break;
          }
          if (done) break;
        }
      }
    }
    log('timetables', await ins(conn, 'timetables',
      ['subject_id', 'section_id', 'teacher_id', 'classroom_id', 'day_of_week', 'start_time', 'end_time'], ttRows));

    // ============================================== 5. EXAMS
    console.log('\nSTEP 5 - Exams inside each semester term\n');
    const [ttAll] = await conn.query('SELECT timetable_id,subject_id,section_id,teacher_id,day_of_week FROM timetables');
    const subjTeacher = {};
    for (const t of ttAll) subjTeacher[t.subject_id] ||= t.teacher_id;

    const examRows = [];
    for (const semId of activeSemIds) {
      const sem = semById.get(semId);
      const s0 = toDate(fmt(new Date(sem.start_date)));
      const s1 = toDate(fmt(new Date(sem.end_date)));
      const span = Math.round((s1 - s0) / 86400000);
      for (const su of (subsBySem[semId] || [])) {
        for (const [type, marks, frac] of [['Mid-Term', 50, 0.45], ['Final', 100, 0.92]]) {
          const dt = new Date(s0.getTime() + Math.round(span * frac) * 86400000);
          examRows.push({
            exam_name: `${su.subject_name} ${type}`, exam_type: type,
            semester_id: semId, subject_id: su.subject_id, exam_date: fmt(dt),
            total_marks: marks, classroom_id: pick(roomIds),
            invigilator_id: subjTeacher[su.subject_id] || pick(allTeacherIds),
          });
        }
      }
    }
    log('exams', await ins(conn, 'exams',
      ['exam_name', 'exam_type', 'semester_id', 'subject_id', 'exam_date', 'total_marks', 'classroom_id', 'invigilator_id'], examRows));

    // ============================================== 6. ENROLLMENTS / ATTENDANCE / MARKS
    console.log('\nSTEP 6 - Enrollments, attendance, marks (all inside term)\n');
    const ttBySection = {};
    for (const t of ttAll) (ttBySection[t.section_id] ||= []).push(t);
    const [examAll] = await conn.query('SELECT exam_id,semester_id,subject_id,total_marks FROM exams');
    const examsBySem = {};
    for (const e of examAll) (examsBySem[e.semester_id] ||= []).push(e);

    // enrollments
    const enrRows = [];
    for (const st of students) {
      const sem = semById.get(st.current_semester_id);
      const base = toDate(fmt(new Date(sem.start_date)));
      for (const su of (subsBySem[st.current_semester_id] || [])) {
        const d = new Date(base.getTime() + ri(0, 12) * 86400000);
        enrRows.push({
          student_id: st.student_id, subject_id: su.subject_id, semester_id: st.current_semester_id,
          enrollment_date: fmt(d), status: chance(0.965) ? 'Active' : 'Dropped',
        });
      }
    }
    log('enrollments', await ins(conn, 'enrollments',
      ['student_id', 'subject_id', 'semester_id', 'enrollment_date', 'status'], enrRows, 2000));

    // attendance - dates strictly inside the term AND matching the slot's weekday
    const termDaysCache = {};
    const attRows = [];
    for (const st of students) {
      const sem = semById.get(st.current_semester_id);
      const key = st.current_semester_id;
      if (!termDaysCache[key]) {
        const out = {};
        let d = toDate(fmt(new Date(sem.start_date)));
        const end = toDate(fmt(new Date(sem.end_date)));
        while (d <= end) { (out[DOW[d.getUTCDay()]] ||= []).push(fmt(d)); d = new Date(d.getTime() + 86400000); }
        termDaysCache[key] = out;
      }
      for (const slot of (ttBySection[st.section_id] || [])) {
        const days = termDaysCache[key][slot.day_of_week] || [];
        for (const day of shuffle(days).slice(0, 6)) {
          const r = rnd();
          attRows.push({
            student_id: st.student_id, subject_id: slot.subject_id, timetable_id: slot.timetable_id,
            att_date: day, status: r < 0.82 ? 'Present' : r < 0.91 ? 'Absent' : r < 0.975 ? 'Late' : 'Leave',
            marked_by: slot.teacher_id, created_at: `${day} ${d2(ri(8, 15))}:${d2(ri(0, 59))}:00`,
          });
        }
      }
    }
    log('attendance', await ins(conn, 'attendance',
      ['student_id', 'subject_id', 'timetable_id', 'att_date', 'status', 'marked_by', 'created_at'], attRows, 2000));

    // marks
    const markRows = [];
    for (const st of students) {
      for (const ex of (examsBySem[st.current_semester_id] || [])) {
        const pct = Math.min(0.98, Math.max(0.32, (rnd() + rnd() + rnd()) / 3 * 0.78 + 0.22));
        markRows.push({
          exam_id: ex.exam_id, student_id: st.student_id,
          obtained_marks: (ex.total_marks * pct).toFixed(2),
          entered_by: subjTeacher[ex.subject_id] || pick(allTeacherIds),
          verified_by: chance(0.78) ? pick(allTeacherIds) : null,
          status: chance(0.88) ? 'Published' : 'Verified',
        });
      }
    }
    log('marks', await ins(conn, 'marks',
      ['exam_id', 'student_id', 'obtained_marks', 'entered_by', 'verified_by', 'status'], markRows, 2000));

    // ============================================== 7. FINANCE
    console.log('\nSTEP 7 - Finance rebuilt against real fee structures\n');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE payments');
    await conn.query('TRUNCATE TABLE student_fees');
    await conn.query('TRUNCATE TABLE fee_structures');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const BASE_FEE = { 1: 85000, 2: 90000, 3: 95000, 4: 80000, 5: 88000 };
    const fsRows = [];
    for (const s of allSems) {
      fsRows.push({ program_id: s.program_id, semester_id: s.semester_id, fee_category: 'Tuition Fee', amount: BASE_FEE[s.program_id].toFixed(2) });
      fsRows.push({ program_id: s.program_id, semester_id: s.semester_id, fee_category: 'Examination Fee', amount: '5000.00' });
      if (s.program_id !== 4) fsRows.push({ program_id: s.program_id, semester_id: s.semester_id, fee_category: 'Laboratory Fee', amount: '7500.00' });
    }
    log('fee_structures', await ins(conn, 'fee_structures', ['program_id', 'semester_id', 'fee_category', 'amount'], fsRows));

    const [fsAll] = await conn.query('SELECT fee_structure_id,program_id,semester_id,fee_category,amount FROM fee_structures');
    const tuitionBy = {};
    for (const f of fsAll) if (f.fee_category === 'Tuition Fee') tuitionBy[`${f.program_id}|${f.semester_id}`] = f;

    const [schol] = await conn.query('SELECT student_id,discount_percentage FROM scholarships');
    const scholBy = {};
    for (const s of schol) scholBy[s.student_id] = Number(s.discount_percentage);

    const [accountants] = await conn.query(
      "SELECT e.employee_id FROM employees e JOIN users u ON u.user_id=e.user_id JOIN roles r ON r.role_id=u.role_id WHERE r.role_name IN ('Accountant','Admin','Super Admin')");
    const recorderPool = accountants.length ? accountants.map((a) => a.employee_id) : [1];

    const sfRows = [];
    let vseq = 0;
    for (const st of students) {
      const fs2 = tuitionBy[`${st.program_id}|${st.current_semester_id}`];
      if (!fs2) continue;
      const sem = semById.get(st.current_semester_id);
      const due = new Date(toDate(fmt(new Date(sem.start_date))).getTime() + 27 * 86400000);
      const gross = Number(fs2.amount) + 5000 + (st.program_id !== 4 ? 7500 : 0);
      const disc = scholBy[st.student_id] || 0;
      const payable = gross * (1 - disc / 100);
      const r = rnd();
      const status = r < 0.42 ? 'Paid' : r < 0.68 ? 'Partially Paid' : r < 0.87 ? 'Unpaid' : 'Overdue';
      sfRows.push({
        _sid: st.student_id, _due: due, _payable: payable, _status: status,
        student_id: st.student_id, fee_structure_id: fs2.fee_structure_id,
        voucher_number: `VCH-2024-${String(++vseq).padStart(5, '0')}`,
        total_payable: payable.toFixed(2), due_date: fmt(due), status,
      });
    }
    log('student_fees', await ins(conn, 'student_fees',
      ['student_id', 'fee_structure_id', 'voucher_number', 'total_payable', 'due_date', 'status'], sfRows, 2000));

    const [sfLive] = await conn.query('SELECT student_fee_id,student_id,total_payable,due_date,status FROM student_fees');
    const METHODS = ['Cash', 'Bank Transfer', 'Card', 'Mobile Wallet'];
    const payRows = [];
    let rseq = 0;
    for (const f of sfLive) {
      const due = toDate(fmt(new Date(f.due_date)));
      const payable = Number(f.total_payable);
      if (f.status === 'Unpaid') continue;                       // genuinely nothing paid
      const parts = f.status === 'Paid' ? (chance(0.35) ? 2 : 1) : 1;
      const totalPaid = f.status === 'Paid' ? payable
        : f.status === 'Partially Paid' ? payable * (0.25 + rnd() * 0.5)
          : payable * (0.1 + rnd() * 0.3);                        // Overdue -> small part paid
      for (let k = 0; k < parts; k++) {
        // Overdue always lands after the due date; others mostly before
        const offset = f.status === 'Overdue' ? ri(5, 60) : (chance(0.8) ? -ri(1, 25) : ri(1, 12));
        const pd = new Date(due.getTime() + offset * 86400000);
        payRows.push({
          student_fee_id: f.student_fee_id,
          amount_paid: (totalPaid / parts).toFixed(2),
          payment_method: pick(METHODS), payment_date: fmt(pd),
          is_late: pd > due ? 1 : 0,
          receipt_number: `RCP-2024-${String(++rseq).padStart(6, '0')}`,
          recorded_by: pick(recorderPool),
        });
      }
    }
    log('payments', await ins(conn, 'payments',
      ['student_fee_id', 'amount_paid', 'payment_method', 'payment_date', 'is_late', 'receipt_number', 'recorded_by'], payRows, 2000));

    // ============================================== 8. CONSTANT-COLUMN FIXES
    console.log('\nSTEP 8 - Give constant columns realistic variety\n');
    const [teachEmp] = await conn.query(
      'SELECT t.teacher_id,e.employee_id,e.department_id FROM teachers t JOIN employees e ON e.employee_id=t.employee_id');
    for (const t of teachEmp) {
      await conn.query('UPDATE teachers SET specialization=? WHERE teacher_id=?',
        [pick(SPEC_BY_DEPT[t.department_id] || SPEC_BY_DEPT[1]), t.teacher_id]);
    }
    log('teachers.specialization', teachEmp.length);

    const teachingEmpIds = new Set(teachEmp.map((t) => t.employee_id));
    const [emps] = await conn.query('SELECT employee_id FROM employees');
    let empUpd = 0;
    for (const e of emps) {
      const teaching = teachingEmpIds.has(e.employee_id);
      const r = rnd();
      const status = teaching
        ? (r < 0.90 ? 'Active' : 'On Leave')
        : (r < 0.82 ? 'Active' : r < 0.92 ? 'On Leave' : r < 0.97 ? 'Retired' : 'Terminated');
      await conn.query('UPDATE employees SET employment_status=? WHERE employee_id=?', [status, e.employee_id]);
      empUpd++;
    }
    log('employees.employment_status', empUpd);

    for (const sec of sections) {
      await conn.query('UPDATE sections SET capacity=? WHERE section_id=?', [pick([40, 45, 50, 55, 60]), sec.section_id]);
    }
    log('sections.capacity', sections.length);

    // academic_status: keep the vast majority Active, add a realistic tail
    await conn.query("UPDATE students SET academic_status='Active'");
    const shuffled = shuffle(students);
    const tail = [['Graduated', 90], ['Alumni', 60], ['Suspended', 45], ['Withdrawn', 50], ['Pending Verification', 25]];
    let cursor = 0;
    for (const [st2, n] of tail) {
      const ids = shuffled.slice(cursor, cursor + n).map((s) => s.student_id);
      cursor += n;
      if (ids.length) await conn.query('UPDATE students SET academic_status=? WHERE student_id IN (?)', [st2, ids]);
    }
    log('students.academic_status', cursor);

    // created_at/updated_at follow the batch intake year
    const [batches] = await conn.query('SELECT batch_id,start_year FROM batches');
    for (const b of batches) {
      await conn.query(
        'UPDATE students SET created_at=?, updated_at=? WHERE batch_id=?',
        [`${b.start_year}-09-${d2(ri(1, 20))} ${d2(ri(9, 16))}:${d2(ri(0, 59))}:00`,
          `2024-0${ri(1, 6)}-${d2(ri(1, 28))} ${d2(ri(9, 16))}:${d2(ri(0, 59))}:00`, b.batch_id]);
    }
    log('students timestamps by batch', batches.length);

    // profile_picture: populate for a realistic subset instead of 100% NULL
    const [ures] = await conn.query(
      "UPDATE users SET profile_picture = CONCAT('uploads/avatars/', user_id, '.jpg') WHERE MOD(user_id, 100) < 55");
    log('users.profile_picture set', ures.affectedRows);

    // teacher_subjects rebuilt against the expanded curriculum
    await conn.query('TRUNCATE TABLE teacher_subjects');
    const tsSeen = new Set(); const tsRows = [];
    for (const sec of sections) {
      const semId = sectionSemester[sec.section_id];
      for (const su of (subsBySem[semId] || [])) {
        const slot = ttAll.find((t) => t.section_id === sec.section_id && t.subject_id === su.subject_id);
        const tid = slot ? slot.teacher_id : pick(allTeacherIds);
        const k = `${tid}|${su.subject_id}|${sec.batch_id}`;
        if (tsSeen.has(k)) continue;
        tsSeen.add(k);
        tsRows.push({ teacher_id: tid, subject_id: su.subject_id, batch_id: sec.batch_id });
      }
    }
    log('teacher_subjects', await ins(conn, 'teacher_subjects', ['teacher_id', 'subject_id', 'batch_id'], tsRows));

    console.log('\n' + '='.repeat(64));
    console.log('REBUILD COMPLETE in', ((Date.now() - t0) / 1000).toFixed(1), 's');
    console.log('='.repeat(64));
  } catch (err) {
    console.error('\n*** FAILED ***\n', err.message);
    if (err.sql) console.error('SQL:', String(err.sql).slice(0, 400));
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
