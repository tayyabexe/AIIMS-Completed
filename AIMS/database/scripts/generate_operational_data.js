/**
 * Fills coverage gaps + populates the operational tables with realistic,
 * Pakistani-context sample data.
 *
 * PHASE 1  structural fixes  - timetable slots for sections 4/7/8, exams for
 *                              semesters 5-8 (without these, attendance and
 *                              marks are impossible for 920 / 1,594 students)
 * PHASE 2  coverage to 2,000 - attendance + marks rebuilt COHERENTLY, results
 *                              and guardians extended, real parents created
 * PHASE 3  operational data  - the 13 requested tables
 *
 * Every generated row is relationship-coherent: a student's attendance is
 * always against a timetable slot for their OWN section, and their marks are
 * always for an exam in their OWN current semester. (The imported dump had
 * 479 and 450 rows respectively that violated this - those are rebuilt.)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------- seeded PRNG
let _seed = 20260724;
const rnd = () => {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------- Pakistani pools
const MALE = ['Muhammad', 'Ahmed', 'Ali', 'Hassan', 'Hussain', 'Bilal', 'Usman', 'Umar', 'Zain', 'Hamza',
  'Faisal', 'Tariq', 'Kamran', 'Imran', 'Adnan', 'Asad', 'Danish', 'Farhan', 'Waqas', 'Shahid',
  'Nadeem', 'Rizwan', 'Saad', 'Talha', 'Yasir', 'Zeeshan', 'Junaid', 'Kashif', 'Naveed', 'Salman',
  'Arsalan', 'Abdullah', 'Ibrahim', 'Rehan', 'Sohail', 'Amir', 'Haris', 'Owais', 'Fahad', 'Noman'];
const FEMALE = ['Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Khadija', 'Amna', 'Hira', 'Sana', 'Sadia', 'Nida',
  'Rabia', 'Sidra', 'Iqra', 'Mehwish', 'Kiran', 'Saba', 'Farah', 'Bushra', 'Anum', 'Maria',
  'Sumaira', 'Nazia', 'Uzma', 'Shazia', 'Tehmina', 'Komal', 'Areeba', 'Hafsa', 'Laiba', 'Mahnoor',
  'Eman', 'Aiman', 'Rimsha', 'Zoya', 'Alishba', 'Noor', 'Sania', 'Hina', 'Samina', 'Nasreen'];
const LAST = ['Khan', 'Ahmed', 'Ali', 'Malik', 'Hussain', 'Shah', 'Butt', 'Chaudhry', 'Sheikh', 'Qureshi',
  'Siddiqui', 'Raza', 'Iqbal', 'Aslam', 'Javed', 'Mahmood', 'Nawaz', 'Rashid', 'Bhatti', 'Awan',
  'Gill', 'Mirza', 'Abbasi', 'Farooq', 'Yousaf', 'Saeed', 'Akram', 'Anwar', 'Bashir', 'Hameed',
  'Latif', 'Munir', 'Nazir', 'Sattar', 'Tanveer', 'Waheed', 'Zaman', 'Amjad', 'Ashraf', 'Riaz'];
const OCCUPATIONS = ['Government Officer', 'Businessman', 'Farmer', 'School Teacher', 'Doctor', 'Civil Engineer',
  'Shopkeeper', 'Bank Manager', 'Army Officer', 'Lawyer', 'Accountant', 'Contractor', 'Pharmacist',
  'Police Officer', 'Journalist', 'Electrician', 'Driver', 'Tailor', 'Property Dealer', 'Retired',
  'Textile Trader', 'Customs Officer', 'WAPDA Employee', 'Railway Employee', 'Housewife'];

const mobile = () => `+92-3${ri(0, 4)}${ri(0, 9)}-${String(ri(1000000, 9999999))}`;
const cnic = () => `${ri(10000, 99999)}-${ri(1000000, 9999999)}-${ri(1, 9)}`;
const d2 = (n) => String(n).padStart(2, '0');
const dstr = (y, m, d) => `${y}-${d2(m)}-${d2(d)}`;

async function insertBatch(conn, table, cols, rows, batchSize = 500) {
  if (!rows.length) return 0;
  let total = 0;
  const colList = cols.map((c) => '`' + c + '`').join(',');
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const ph = chunk.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',');
    const flat = [];
    for (const r of chunk) for (const c of cols) flat.push(r[c]);
    const [res] = await conn.query(`INSERT INTO \`${table}\` (${colList}) VALUES ${ph}`, flat);
    total += res.affectedRows;
  }
  return total;
}

// working weekdays in a range, as YYYY-MM-DD
function weekdays(y, m1, m2) {
  const out = [];
  for (let m = m1; m <= m2; m++) {
    const dim = new Date(y, m, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6) out.push(dstr(y, m, d));
    }
  }
  return out;
}
const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

(async () => {
  const t0 = Date.now();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(path.resolve(__dirname, '..', 'config', 'ca.pem')).toString(), rejectUnauthorized: true },
    connectTimeout: 30000,
  });
  const log = (t, n) => console.log(`  ${t.padEnd(26)} ${String(n).padStart(6)} rows`);

  try {
    // ---------------------------------------------------- load current state
    const [students] = await conn.query(
      'SELECT student_id,user_id,first_name,last_name,gender,program_id,batch_id,section_id,current_semester_id FROM students'
    );
    const [sections] = await conn.query(
      'SELECT sec.section_id,sec.batch_id,b.program_id FROM sections sec JOIN batches b ON b.batch_id=sec.batch_id'
    );
    const [subjects] = await conn.query(
      'SELECT su.subject_id,su.subject_code,su.subject_name,su.semester_id,se.program_id FROM subjects su JOIN semesters se ON se.semester_id=su.semester_id'
    );
    const [semesters] = await conn.query('SELECT semester_id,program_id,semester_number FROM semesters');
    const [teachers] = await conn.query('SELECT teacher_id,employee_id FROM teachers');
    const [employees] = await conn.query('SELECT employee_id,user_id,department_id,basic_salary,designation FROM employees');
    const [classrooms] = await conn.query('SELECT classroom_id FROM classrooms');
    const [adminUsers] = await conn.query(
      "SELECT u.user_id FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_name IN ('Super Admin','Admin')"
    );

    const secById = Object.fromEntries(sections.map((s) => [s.section_id, s]));
    const subjByProgram = {};
    for (const s of subjects) (subjByProgram[s.program_id] ||= []).push(s);
    const subjBySemester = Object.fromEntries(subjects.map((s) => [s.semester_id, s]));
    const teacherIds = teachers.map((t) => t.teacher_id);
    const classroomIds = classrooms.map((c) => c.classroom_id);
    const empIds = employees.map((e) => e.employee_id);

    // ==================================================== PHASE 1
    console.log('\nPHASE 1 - Structural fixes\n');

    // --- 1a. timetable slots so EVERY section has at least one -------------
    const [ttExisting] = await conn.query('SELECT timetable_id,subject_id,section_id,teacher_id,classroom_id,day_of_week,start_time FROM timetables');
    const sectionsWithTT = new Set(ttExisting.map((t) => t.section_id));
    const busy = new Set(ttExisting.map((t) => `${t.day_of_week}|${t.start_time}|T${t.teacher_id}`)
      .concat(ttExisting.map((t) => `${t.day_of_week}|${t.start_time}|C${t.classroom_id}`)));

    // The institute's period grid, imported rather than restated. This used to
    // be a literal ending 14:00-15:30, which drifted from the grid the API and
    // the portals use: generated rows landed in a 4th period the application
    // did not recognise, so a subject scheduled there showed up at a time no
    // slot column matched. Single source of truth: backend/src/config/timetableSlots.js
    const SLOTS = require('../../backend/src/config/timetableSlots')
      .SLOTS.map((s) => [s.start_time, s.end_time]);
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const newTT = [];
    let ttTeacherCursor = 5; // teachers 1-5 already used by the dump
    for (const sec of sections) {
      if (sectionsWithTT.has(sec.section_id)) continue;
      const candidates = subjByProgram[sec.program_id] || [];
      if (!candidates.length) { console.log(`  [!] section ${sec.section_id}: no subject in program ${sec.program_id}`); continue; }
      const subj = candidates[candidates.length - 1]; // highest semester subject of that program
      let placed = false;
      for (const day of DAYS) {
        for (const [st, en] of SLOTS) {
          const teacher = teacherIds[ttTeacherCursor % teacherIds.length];
          const room = classroomIds[(ttTeacherCursor + 1) % classroomIds.length];
          if (busy.has(`${day}|${st}|T${teacher}`) || busy.has(`${day}|${st}|C${room}`)) continue;
          newTT.push({ subject_id: subj.subject_id, section_id: sec.section_id, teacher_id: teacher, classroom_id: room, day_of_week: day, start_time: st, end_time: en });
          busy.add(`${day}|${st}|T${teacher}`); busy.add(`${day}|${st}|C${room}`);
          ttTeacherCursor++; placed = true; break;
        }
        if (placed) break;
      }
    }
    log('timetables (new slots)', await insertBatch(conn, 'timetables',
      ['subject_id', 'section_id', 'teacher_id', 'classroom_id', 'day_of_week', 'start_time', 'end_time'], newTT));

    // --- 1b. exams so EVERY semester with students has Mid-Term + Final ----
    const [examExisting] = await conn.query('SELECT exam_id,semester_id,exam_type,subject_id FROM exams');
    const haveExam = new Set(examExisting.map((e) => `${e.semester_id}|${e.exam_type}`));
    const semWithStudents = [...new Set(students.map((s) => s.current_semester_id))].filter(Boolean).sort();
    const newExams = [];
    for (const semId of semWithStudents) {
      const subj = subjBySemester[semId];
      if (!subj) continue;
      const semNo = semesters.find((s) => s.semester_id === semId)?.semester_number ?? 1;
      for (const [type, marks, mon] of [['Mid-Term', 50, 4], ['Final', 100, 6]]) {
        if (haveExam.has(`${semId}|${type}`)) continue;
        newExams.push({
          exam_name: `${subj.subject_name} ${type}`,
          exam_type: type, semester_id: semId, subject_id: subj.subject_id,
          exam_date: dstr(2024, mon, ri(10, 25)), total_marks: marks,
          classroom_id: pick(classroomIds), invigilator_id: pick(teacherIds),
        });
      }
    }
    log('exams (new)', await insertBatch(conn, 'exams',
      ['exam_name', 'exam_type', 'semester_id', 'subject_id', 'exam_date', 'total_marks', 'classroom_id', 'invigilator_id'], newExams));

    // ==================================================== PHASE 2
    console.log('\nPHASE 2 - Coverage to 2,000 students\n');

    // reload timetables / exams now that gaps are filled
    const [allTT] = await conn.query('SELECT timetable_id,subject_id,section_id,teacher_id,day_of_week FROM timetables');
    const ttBySection = {};
    for (const t of allTT) (ttBySection[t.section_id] ||= []).push(t);
    const [allExams] = await conn.query('SELECT exam_id,semester_id,subject_id,total_marks FROM exams');
    const examsBySem = {};
    for (const e of allExams) (examsBySem[e.semester_id] ||= []).push(e);

    // --- 2a. attendance : rebuilt coherently for all 2,000 ------------------
    await conn.query('TRUNCATE TABLE attendance');
    const termDays = weekdays(2024, 3, 5); // Mar-May 2024 teaching term
    const attRows = [];
    for (const st of students) {
      const slots = ttBySection[st.section_id];
      if (!slots || !slots.length) continue;
      for (const slot of slots) {
        // only dates whose weekday matches this slot's day_of_week
        const days = termDays.filter((d) => DOW_NAME[new Date(d).getDay()] === slot.day_of_week);
        for (const day of shuffle(days).slice(0, ri(8, 12))) {
          const r = rnd();
          const status = r < 0.80 ? 'Present' : r < 0.90 ? 'Absent' : r < 0.97 ? 'Late' : 'Leave';
          attRows.push({
            student_id: st.student_id, subject_id: slot.subject_id, timetable_id: slot.timetable_id,
            att_date: day, status, marked_by: slot.teacher_id,
            created_at: `${day} ${d2(ri(8, 15))}:${d2(ri(0, 59))}:00`,
          });
        }
      }
    }
    log('attendance (rebuilt)', await insertBatch(conn, 'attendance',
      ['student_id', 'subject_id', 'timetable_id', 'att_date', 'status', 'marked_by', 'created_at'], attRows, 1000));

    // --- 2b. marks : rebuilt coherently for all 2,000 ----------------------
    await conn.query('TRUNCATE TABLE marks');
    const subjTeacher = {};
    for (const t of allTT) subjTeacher[t.subject_id] ||= t.teacher_id;
    const markRows = [];
    for (const st of students) {
      const exams = examsBySem[st.current_semester_id] || [];
      for (const ex of exams) {
        // realistic bell-ish distribution, 35%..98% of total
        const pct = Math.min(0.98, Math.max(0.35, (rnd() + rnd() + rnd()) / 3 * 0.75 + 0.25));
        markRows.push({
          exam_id: ex.exam_id, student_id: st.student_id,
          obtained_marks: (ex.total_marks * pct).toFixed(2),
          entered_by: subjTeacher[ex.subject_id] || pick(teacherIds),
          verified_by: chance(0.75) ? pick(teacherIds) : null,
          status: chance(0.85) ? 'Published' : 'Verified',
        });
      }
    }
    log('marks (rebuilt)', await insertBatch(conn, 'marks',
      ['exam_id', 'student_id', 'obtained_marks', 'entered_by', 'verified_by', 'status'], markRows, 1000));

    // --- 2c. results : extend to all 2,000 --------------------------------
    const [haveRes] = await conn.query('SELECT DISTINCT student_id FROM results');
    const hasRes = new Set(haveRes.map((r) => r.student_id));
    const resRows = students.filter((s) => !hasRes.has(s.student_id)).map((s) => {
      const gpa = (2.0 + rnd() * 2.0);
      const cgpa = Math.max(2.0, Math.min(4.0, gpa + (rnd() - 0.5) * 0.6));
      return {
        student_id: s.student_id, semester_id: s.current_semester_id,
        gpa: gpa.toFixed(2), cgpa: cgpa.toFixed(2),
        published_at: `2024-07-${d2(ri(1, 28))} ${d2(ri(9, 17))}:00:00`, status: 'Published',
      };
    });
    log('results (added)', await insertBatch(conn, 'results',
      ['student_id', 'semester_id', 'gpa', 'cgpa', 'published_at', 'status'], resRows, 500));

    // --- 2d. parents : real names + extend guardians to all 2,000 ---------
    // upgrade the PLACEHOLDER parents created during the import
    const [phParents] = await conn.query(
      "SELECT p.parent_id, s.last_name FROM parents p JOIN student_guardians sg ON sg.parent_id=p.parent_id JOIN students s ON s.student_id=sg.student_id WHERE p.first_name='PLACEHOLDER' GROUP BY p.parent_id, s.last_name"
    );
    for (let i = 0; i < phParents.length; i += 1) {
      const p = phParents[i];
      const male = chance(0.62);
      await conn.query('UPDATE parents SET first_name=?, last_name=?, occupation=? WHERE parent_id=?',
        [male ? pick(MALE) : pick(FEMALE), p.last_name, pick(OCCUPATIONS), p.parent_id]);
    }
    console.log(`  ${'parents (names fixed)'.padEnd(26)} ${String(phParents.length).padStart(6)} rows`);

    const [gHave] = await conn.query('SELECT DISTINCT student_id FROM student_guardians');
    const hasG = new Set(gHave.map((r) => r.student_id));
    const needG = students.filter((s) => !hasG.has(s.student_id));

    const [[{ mu }]] = await conn.query('SELECT MAX(user_id) mu FROM users');
    const [[{ mp }]] = await conn.query('SELECT MAX(parent_id) mp FROM parents');
    const [[{ prid }]] = await conn.query("SELECT role_id prid FROM roles WHERE role_name='Parent'");
    const [[{ ph }]] = await conn.query("SELECT password_hash ph FROM users WHERE role_id=? LIMIT 1", [prid]);

    let uid = mu, pid = mp;
    const newParentUsers = [], newParents = [], newGuardians = [];
    for (const st of needG) {
      uid++; pid++;
      const male = chance(0.62);
      const fn = male ? pick(MALE) : pick(FEMALE);
      newParentUsers.push({
        user_id: uid, email: `parent${pid}@aims.edu.pk`, password_hash: ph, role_id: prid,
        phone: mobile(), profile_picture: null, is_active: 1, email_verified: chance(0.8) ? 1 : 0,
        failed_login_attempts: 0, last_login: null, last_password_change: null, is_deleted: 0,
        created_at: '2023-09-01 10:00:00', updated_at: '2023-09-01 10:00:00',
      });
      newParents.push({
        parent_id: pid, user_id: uid, first_name: fn, last_name: st.last_name,
        phone: mobile(), occupation: pick(OCCUPATIONS), is_deleted: 0,
      });
      newGuardians.push({
        student_id: st.student_id, parent_id: pid,
        relationship: male ? 'Father' : (chance(0.75) ? 'Mother' : 'Guardian'),
      });
    }
    log('users (parent accounts)', await insertBatch(conn, 'users',
      ['user_id', 'email', 'password_hash', 'role_id', 'phone', 'profile_picture', 'is_active', 'email_verified',
        'failed_login_attempts', 'last_login', 'last_password_change', 'is_deleted', 'created_at', 'updated_at'], newParentUsers, 300));
    log('parents (new)', await insertBatch(conn, 'parents',
      ['parent_id', 'user_id', 'first_name', 'last_name', 'phone', 'occupation', 'is_deleted'], newParents, 300));
    log('student_guardians (new)', await insertBatch(conn, 'student_guardians',
      ['student_id', 'parent_id', 'relationship'], newGuardians, 300));

    // ==================================================== PHASE 3
    console.log('\nPHASE 3 - Operational tables\n');
    const [allParents] = await conn.query('SELECT parent_id FROM parents');
    const parentIds = allParents.map((p) => p.parent_id);
    const [allStudentUsers] = await conn.query(
      "SELECT u.user_id FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_name='Student'"
    );
    const [staffUsers] = await conn.query(
      "SELECT u.user_id FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_name IN ('Teacher','HR','Accountant','Library Staff','Admin')"
    );

    // --- books ------------------------------------------------------------
    const BOOKS = [
      ['Introduction to Algorithms', 'Thomas H. Cormen', 'Computer Science'],
      ['Database System Concepts', 'Abraham Silberschatz', 'Computer Science'],
      ['Operating System Concepts', 'Abraham Silberschatz', 'Computer Science'],
      ['Computer Networks', 'Andrew S. Tanenbaum', 'Computer Science'],
      ['Artificial Intelligence: A Modern Approach', 'Stuart Russell', 'Computer Science'],
      ['Clean Code', 'Robert C. Martin', 'Software Engineering'],
      ['Software Engineering', 'Ian Sommerville', 'Software Engineering'],
      ['Data Structures and Algorithms in C++', 'Adam Drozdek', 'Computer Science'],
      ['Discrete Mathematics and Its Applications', 'Kenneth H. Rosen', 'Mathematics'],
      ['Calculus: Early Transcendentals', 'James Stewart', 'Mathematics'],
      ['Linear Algebra and Its Applications', 'David C. Lay', 'Mathematics'],
      ['Fundamentals of Electric Circuits', 'Charles K. Alexander', 'Electrical Engineering'],
      ['Microelectronic Circuits', 'Adel S. Sedra', 'Electrical Engineering'],
      ['Signals and Systems', 'Alan V. Oppenheim', 'Electrical Engineering'],
      ['Digital Design', 'M. Morris Mano', 'Electrical Engineering'],
      ['Principles of Management', 'Harold Koontz', 'Business Administration'],
      ['Marketing Management', 'Philip Kotler', 'Business Administration'],
      ['Financial Accounting', 'Jerry J. Weygandt', 'Business Administration'],
      ['Organizational Behavior', 'Stephen P. Robbins', 'Business Administration'],
      ['Principles of Economics', 'N. Gregory Mankiw', 'Economics'],
      ['Pakistan Studies', 'Ikram Rabbani', 'Pakistan Studies'],
      ['The Struggle for Pakistan', 'Ayesha Jalal', 'Pakistan Studies'],
      ['Jinnah of Pakistan', 'Stanley Wolpert', 'Pakistan Studies'],
      ['Islamic Studies for Undergraduates', 'Dr. Muhammad Tahir', 'Islamic Studies'],
      ['Seerat-un-Nabi', 'Shibli Nomani', 'Islamic Studies'],
      ['Bang-e-Dra', 'Allama Muhammad Iqbal', 'Urdu Literature'],
      ['Bal-e-Jibril', 'Allama Muhammad Iqbal', 'Urdu Literature'],
      ['Aab-e-Gum', 'Mushtaq Ahmed Yousufi', 'Urdu Literature'],
      ['Raja Gidh', 'Bano Qudsia', 'Urdu Literature'],
      ['Peer-e-Kamil', 'Umera Ahmed', 'Urdu Literature'],
      ['English Grammar in Use', 'Raymond Murphy', 'English'],
      ['Academic Writing for Graduate Students', 'John M. Swales', 'English'],
      ['Applied Statistics and Probability for Engineers', 'Douglas C. Montgomery', 'Statistics'],
      ['Introduction to Machine Learning', 'Ethem Alpaydin', 'Computer Science'],
      ['Data Mining: Concepts and Techniques', 'Jiawei Han', 'Computer Science'],
    ];
    const bookRows = BOOKS.map((b, i) => {
      const total = ri(3, 12);
      return {
        isbn: `978-969-${String(1000 + i).padStart(4, '0')}-${ri(10, 99)}-${ri(0, 9)}`,
        title: b[0], author: b[1], category: b[2],
        total_copies: total, available_copies: total, is_deleted: 0,
      };
    });
    log('books', await insertBatch(conn, 'books',
      ['isbn', 'title', 'author', 'category', 'total_copies', 'available_copies', 'is_deleted'], bookRows));

    const [bookRs] = await conn.query('SELECT book_id,total_copies FROM books');
    // --- book_issues (respects available_copies <= total_copies CHECK) -----
    const borrowerPool = [...allStudentUsers.map((u) => u.user_id), ...staffUsers.map((u) => u.user_id)];
    const issueRows = [];
    const outstanding = {};
    for (const b of bookRs) {
      const n = ri(4, 14);
      for (let k = 0; k < n; k++) {
        const iy = 2024, im = ri(1, 6), id = ri(1, 28);
        const issue = dstr(iy, im, id);
        const dueD = new Date(iy, im - 1, id + 14);
        const due = dstr(dueD.getFullYear(), dueD.getMonth() + 1, dueD.getDate());
        const returned = chance(0.78);
        let ret = null, fine = 0;
        if (returned) {
          const late = chance(0.25) ? ri(1, 20) : -ri(0, 10);
          const rD = new Date(dueD); rD.setDate(rD.getDate() + late);
          ret = dstr(rD.getFullYear(), rD.getMonth() + 1, rD.getDate());
          if (late > 0) fine = late * 10;              // Rs. 10 per late day
        } else {
          outstanding[b.book_id] = (outstanding[b.book_id] || 0) + 1;
          if (outstanding[b.book_id] > b.total_copies) { outstanding[b.book_id]--; continue; }
        }
        issueRows.push({
          book_id: b.book_id, borrower_user_id: pick(borrowerPool),
          issue_date: issue, due_date: due, return_date: ret, fine_amount: fine.toFixed(2),
        });
      }
    }
    log('book_issues', await insertBatch(conn, 'book_issues',
      ['book_id', 'borrower_user_id', 'issue_date', 'due_date', 'return_date', 'fine_amount'], issueRows, 500));
    for (const [bid, out] of Object.entries(outstanding)) {
      await conn.query('UPDATE books SET available_copies = total_copies - ? WHERE book_id = ?', [out, bid]);
    }
    console.log('  books.available_copies reconciled against un-returned issues');

    // --- payroll ----------------------------------------------------------
    const MONTHS = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'];
    const payrollRows = [];
    for (const e of employees) {
      for (const m of MONTHS) {
        const basic = Number(e.basic_salary);
        const allow = Math.round(basic * (0.15 + rnd() * 0.15));
        const ded = Math.round(basic * (0.05 + rnd() * 0.07));
        payrollRows.push({
          employee_id: e.employee_id, month: m, basic_salary: basic.toFixed(2),
          allowances: allow.toFixed(2), deductions: ded.toFixed(2),
          net_salary: (basic + allow - ded).toFixed(2),
          generated_at: `${m}-28 18:00:00`,
        });
      }
    }
    log('payroll', await insertBatch(conn, 'payroll',
      ['employee_id', 'month', 'basic_salary', 'allowances', 'deductions', 'net_salary', 'generated_at'], payrollRows));

    // --- teacher_attendance ----------------------------------------------
    const taDays = weekdays(2024, 3, 5);
    const taRows = [];
    for (const e of employees) {
      for (const day of taDays) {
        const r = rnd();
        let status = 'Present', ci = '08:%', co = null;
        if (r > 0.94) status = 'Absent';
        else if (r > 0.90) status = 'Leave';
        else if (r > 0.82) status = 'Late';
        if (status === 'Absent' || status === 'Leave') {
          taRows.push({ employee_id: e.employee_id, att_date: day, check_in: null, check_out: null, status });
        } else {
          const inH = status === 'Late' ? ri(9, 10) : 8;
          taRows.push({
            employee_id: e.employee_id, att_date: day,
            check_in: `${d2(inH)}:${d2(ri(0, 59))}:00`,
            check_out: `${d2(ri(15, 17))}:${d2(ri(0, 59))}:00`, status,
          });
        }
      }
    }
    log('teacher_attendance', await insertBatch(conn, 'teacher_attendance',
      ['employee_id', 'att_date', 'check_in', 'check_out', 'status'], taRows, 1000));

    // --- employee_documents ----------------------------------------------
    const EDOC = ['CNIC Copy', 'Degree Certificate', 'Experience Letter', 'Appointment Letter',
      'Domicile Certificate', 'Medical Certificate', 'Police Verification'];
    const edRows = [];
    for (const e of employees) {
      for (const dt of shuffle(EDOC).slice(0, ri(3, 5))) {
        edRows.push({
          employee_id: e.employee_id, doc_type: dt,
          file_url: `uploads/employees/${e.employee_id}/${dt.toLowerCase().replace(/\s+/g, '_')}.pdf`,
          verified: chance(0.8) ? 1 : 0,
        });
      }
    }
    log('employee_documents', await insertBatch(conn, 'employee_documents',
      ['employee_id', 'doc_type', 'file_url', 'verified'], edRows));

    // --- performance_evaluations (evaluated_by must be an employee) -------
    const evaluators = employees.filter((e) => /HR|Administrator|Chief/i.test(e.designation || '')).map((e) => e.employee_id);
    const evalPool = evaluators.length ? evaluators : empIds.slice(0, 3);
    const REMARKS = {
      Excellent: ['Consistently exceeds expectations in teaching and research.', 'Outstanding student feedback and departmental contribution.', 'Exemplary punctuality and academic leadership.'],
      Good: ['Meets all core responsibilities with good student feedback.', 'Reliable performance; encouraged to publish more.', 'Good classroom management and result delivery.'],
      Average: ['Satisfactory performance; improvement needed in result submission timelines.', 'Adequate delivery; advised to enhance student engagement.', 'Meets minimum expectations; attendance could improve.'],
      Poor: ['Repeated delays in result submission; improvement plan required.', 'Below expected student feedback scores this period.', 'Frequent absences affecting class schedule.'],
    };
    const peRows = [];
    for (const e of employees) {
      for (const period of ['2023-Annual', '2024-Mid Year']) {
        const r = rnd();
        const rating = r < 0.3 ? 'Excellent' : r < 0.7 ? 'Good' : r < 0.92 ? 'Average' : 'Poor';
        let evaluator = pick(evalPool);
        if (evaluator === e.employee_id) evaluator = evalPool.find((x) => x !== e.employee_id) ?? evalPool[0];
        peRows.push({
          employee_id: e.employee_id, evaluation_period: period, rating,
          remarks: pick(REMARKS[rating]), evaluated_by: evaluator,
        });
      }
    }
    log('performance_evaluations', await insertBatch(conn, 'performance_evaluations',
      ['employee_id', 'evaluation_period', 'rating', 'remarks', 'evaluated_by'], peRows));

    // --- leave_requests ---------------------------------------------------
    const LEAVE = ['Casual Leave', 'Sick Leave', 'Annual Leave', 'Hajj Leave', 'Maternity Leave',
      'Paternity Leave', 'Study Leave', 'Emergency Leave'];
    const approverUsers = adminUsers.map((u) => u.user_id);
    const staffUserIds = employees.map((e) => e.user_id);
    const lrRows = [];
    for (let i = 0; i < 160; i++) {
      const uidL = pick(staffUserIds);
      const m = ri(1, 6), d = ri(1, 25), len = ri(1, 7);
      const sD = new Date(2024, m - 1, d); const eD = new Date(2024, m - 1, d + len);
      const r = rnd();
      const status = r < 0.6 ? 'Approved' : r < 0.85 ? 'Pending' : 'Rejected';
      lrRows.push({
        user_id: uidL, leave_type: pick(LEAVE),
        start_date: dstr(sD.getFullYear(), sD.getMonth() + 1, sD.getDate()),
        end_date: dstr(eD.getFullYear(), eD.getMonth() + 1, eD.getDate()),
        status, approved_by: status === 'Pending' ? null : pick(approverUsers),
      });
    }
    log('leave_requests', await insertBatch(conn, 'leave_requests',
      ['user_id', 'leave_type', 'start_date', 'end_date', 'status', 'approved_by'], lrRows));

    // --- teacher_subjects (subject + batch must share a program) ----------
    const [batches] = await conn.query('SELECT batch_id,program_id FROM batches');
    const tsSet = new Set(); const tsRows = [];
    let tcur = 0;
    for (const b of batches) {
      for (const s of (subjByProgram[b.program_id] || [])) {
        const t = teacherIds[tcur++ % teacherIds.length];
        const key = `${t}|${s.subject_id}|${b.batch_id}`;
        if (tsSet.has(key)) continue;
        tsSet.add(key);
        tsRows.push({ teacher_id: t, subject_id: s.subject_id, batch_id: b.batch_id });
      }
    }
    log('teacher_subjects', await insertBatch(conn, 'teacher_subjects',
      ['teacher_id', 'subject_id', 'batch_id'], tsRows));

    // --- student_documents ------------------------------------------------
    const sdRows = [];
    for (const st of students) {
      const base = ['CNIC', 'Photo', 'Admission Form'];
      const extra = shuffle(['B-Form', 'Certificate', 'Transcript', 'Medical', 'Fee Challan', 'Result Card']).slice(0, ri(0, 2));
      for (const dt of [...base, ...extra]) {
        sdRows.push({
          student_id: st.student_id, doc_type: dt,
          file_url: `uploads/students/${st.student_id}/${dt.toLowerCase().replace(/[\s-]+/g, '_')}.pdf`,
          verified: chance(0.75) ? 1 : 0,
          uploaded_at: `2023-09-${d2(ri(1, 28))} ${d2(ri(9, 17))}:${d2(ri(0, 59))}:00`,
        });
      }
    }
    log('student_documents', await insertBatch(conn, 'student_documents',
      ['student_id', 'doc_type', 'file_url', 'verified', 'uploaded_at'], sdRows, 1000));

    // --- scholarships (discount 0<x<=100 CHECK) ---------------------------
    const SCH = [['Merit Scholarship', 25, 50], ['Need-Based Financial Aid', 20, 40],
      ['HEC Ehsaas Undergraduate Scholarship', 50, 100], ['Sports Scholarship', 15, 30],
      ['Hafiz-e-Quran Scholarship', 10, 25], ['Kinship / Sibling Discount', 10, 20],
      ['Board Position Scholarship', 40, 75]];
    const schStudents = shuffle(students).slice(0, 260);
    const schRows = schStudents.map((s) => {
      const [type, lo, hi] = pick(SCH);
      return {
        student_id: s.student_id, semester_id: s.current_semester_id, scholarship_type: type,
        discount_percentage: ri(lo, hi).toFixed(2), approved_by: pick(evalPool),
      };
    });
    log('scholarships', await insertBatch(conn, 'scholarships',
      ['student_id', 'semester_id', 'scholarship_type', 'discount_percentage', 'approved_by'], schRows, 500));

    // --- meeting_requests -------------------------------------------------
    const MNOTES = ['Wish to discuss my son\'s attendance shortfall.', 'Request meeting regarding daughter\'s midterm result.',
      'Need guidance on fee instalment plan.', 'Concerned about declining GPA this semester.',
      'Discussion about subject selection for next semester.', 'Follow-up on previously agreed improvement plan.',
      'Request to discuss scholarship eligibility.', 'Query about detained status due to attendance.'];
    const mrRows = [];
    for (let i = 0; i < 220; i++) {
      const r = rnd();
      mrRows.push({
        parent_id: pick(parentIds), teacher_id: pick(teacherIds),
        requested_date: `2024-${d2(ri(3, 6))}-${d2(ri(1, 28))} ${d2(ri(9, 16))}:${pick(['00', '30'])}:00`,
        status: r < 0.4 ? 'Completed' : r < 0.65 ? 'Approved' : r < 0.88 ? 'Pending' : 'Rejected',
        notes: pick(MNOTES),
      });
    }
    log('meeting_requests', await insertBatch(conn, 'meeting_requests',
      ['parent_id', 'teacher_id', 'requested_date', 'status', 'notes'], mrRows));

    // --- announcements ----------------------------------------------------
    const ANN = [
      ['Spring 2024 Semester Registration Open', 'Registration for the Spring 2024 semester is now open. All students must complete course registration through the student portal before 25th February 2024. Late registration will incur a fine of Rs. 2,000.', 'Student'],
      ['Mid-Term Examination Schedule Announced', 'The mid-term examination schedule for Spring 2024 has been uploaded to the portal. Students are advised to check their date sheets and report to the examination hall 15 minutes before the scheduled time.', 'Student'],
      ['Fee Submission Deadline Extended', 'The last date for submission of semester fees has been extended to 15th March 2024. Fee challans can be downloaded from the student portal and submitted at any HBL branch.', 'Student'],
      ['Eid-ul-Fitr Holidays', 'The university will remain closed from 10th April to 14th April 2024 on account of Eid-ul-Fitr. Classes will resume on 15th April 2024. Eid Mubarak to all students and staff.', 'All'],
      ['Annual Sports Gala 2024', 'The Annual Sports Gala will be held from 5th to 9th May 2024. Students interested in participating should register with the Sports Department before 25th April.', 'Student'],
      ['Faculty Meeting - Result Compilation', 'All faculty members are requested to attend the result compilation meeting on 20th June 2024 at 11:00 AM in the Main Conference Hall. Attendance is mandatory.', 'Teacher'],
      ['Library Timings Extended During Exams', 'The central library will remain open until 10:00 PM during the examination period. Students are requested to carry their university ID cards at all times.', 'Student'],
      ['Submission of Semester Results', 'All faculty members must submit final semester results to the Examination Department by 30th June 2024. Delays will be reported to the Dean.', 'Teacher'],
      ['Parent-Teacher Meeting Scheduled', 'A parent-teacher meeting is scheduled for 18th May 2024 from 10:00 AM to 2:00 PM. Parents are encouraged to book slots through the parent portal.', 'Parent'],
      ['HEC Scholarship Applications Invited', 'Applications are invited for the HEC Ehsaas Undergraduate Scholarship for the academic year 2024-25. Eligible students may apply through the Financial Aid Office before 30th April 2024.', 'Student'],
      ['Payroll Processing Notice', 'Salary for the month of June 2024 will be credited on 28th June. Employees are requested to verify their bank details with the HR Department.', 'HR'],
      ['Independence Day Celebration', 'The university will celebrate Pakistan Independence Day on 14th August with a flag hoisting ceremony at 8:00 AM in the main ground. All students and staff are invited.', 'All'],
      ['New Books Added to Central Library', 'A fresh collection of Computer Science, Engineering and Urdu Literature titles has been added to the central library. Students may check availability through the library portal.', 'All'],
      ['Attendance Shortage Warning', 'Students with attendance below 75% will not be permitted to sit in the final examinations. Please check your attendance status on the portal immediately.', 'Student'],
      ['Convocation 2024 Registration', 'Graduating students of the 2024 batch must register for the Annual Convocation before 31st July 2024 through the alumni portal.', 'Student'],
    ];
    const annRows = ANN.map((a, i) => ({
      title: a[0], content: a[1], target_role: a[2], posted_by: pick(approverUsers),
      created_at: `2024-${d2(ri(1, 6))}-${d2(ri(1, 28))} ${d2(ri(9, 16))}:${d2(ri(0, 59))}:00`,
    }));
    log('announcements', await insertBatch(conn, 'announcements',
      ['title', 'content', 'target_role', 'posted_by', 'created_at'], annRows));

    // --- notifications ----------------------------------------------------
    const NOTIF_STUDENT = [
      ['Your fee challan for Spring 2024 has been generated. Please pay before the due date.', 'Fee'],
      ['Your mid-term result has been published. Check the portal for details.', 'Result'],
      ['Your attendance in one subject has fallen below 75%. Immediate improvement required.', 'Attendance'],
      ['Course registration for the next semester closes in 3 days.', 'Registration'],
      ['Your scholarship application has been approved.', 'Scholarship'],
      ['A library book issued to you is due for return tomorrow.', 'Library'],
      ['Your submitted documents have been verified by the admissions office.', 'Document'],
      ['Semester result has been published on the student portal.', 'Result'],
    ];
    const NOTIF_STAFF = [
      ['Your leave request has been approved by the administration.', 'Leave'],
      ['Salary for this month has been credited to your account.', 'Payroll'],
      ['Please submit the pending result sheets for your assigned subjects.', 'Academic'],
      ['A parent has requested a meeting with you. Check the portal.', 'Meeting'],
      ['Your performance evaluation for this period has been recorded.', 'HR'],
    ];
    const notifRows = [];
    for (const u of shuffle(allStudentUsers).slice(0, 1200)) {
      for (let k = 0; k < ri(1, 3); k++) {
        const [msg, type] = pick(NOTIF_STUDENT);
        notifRows.push({
          user_id: u.user_id, message: msg, type, is_read: chance(0.55) ? 1 : 0,
          created_at: `2024-${d2(ri(1, 6))}-${d2(ri(1, 28))} ${d2(ri(8, 20))}:${d2(ri(0, 59))}:00`,
        });
      }
    }
    for (const u of staffUsers) {
      for (let k = 0; k < ri(1, 4); k++) {
        const [msg, type] = pick(NOTIF_STAFF);
        notifRows.push({
          user_id: u.user_id, message: msg, type, is_read: chance(0.6) ? 1 : 0,
          created_at: `2024-${d2(ri(1, 6))}-${d2(ri(1, 28))} ${d2(ri(8, 20))}:${d2(ri(0, 59))}:00`,
        });
      }
    }
    log('notifications', await insertBatch(conn, 'notifications',
      ['user_id', 'message', 'type', 'is_read', 'created_at'], notifRows, 1000));

    console.log('\n' + '='.repeat(60));
    console.log('GENERATION COMPLETE in', ((Date.now() - t0) / 1000).toFixed(1), 's');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('\n*** FAILED ***');
    console.error(err.message);
    if (err.sql) console.error('SQL:', String(err.sql).slice(0, 400));
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
