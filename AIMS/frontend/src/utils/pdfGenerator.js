import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatMoney, currencySymbol } from './currency';
import { gradeFromGpa, PASS_GPA } from './helpers';

// ─── Institute branding ──────────────────────────────────────────────────
const INSTITUTE = {
  name: 'AIIMS',
  subtitle: 'AI-Based Institute Management System',
  address: 'Islamabad, Pakistan',
  primaryColor: [153, 27, 27],
  secondaryColor: [11, 19, 43],
  accentColor: [99, 102, 241],
};

function addHeader(doc, pageWidth, title) {
  doc.setFillColor(...INSTITUTE.primaryColor);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(INSTITUTE.name, pageWidth / 2, 12, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(INSTITUTE.subtitle, pageWidth / 2, 18.5, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(title, pageWidth / 2, 26, { align: 'center' });
}

function addFooter(doc, pageWidth) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(14, 282, pageWidth - 14, 282);
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.text(INSTITUTE.address, pageWidth / 2, 287, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, 287, { align: 'right' });
  }
}

function addInfoLine(doc, text, y) {
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(text, 14, y);
  return y + 5;
}

function roundedRect(doc, x, y, w, h, r) {
  doc.roundedRect(x, y, w, h, r, r);
}

// ─── Parse attendance value (handles "92.5%" string or number) ────────────
function parseAttendance(val) {
  if (typeof val === 'string') return parseFloat(val.replace('%', '')) || 0;
  return parseFloat(val) || 0;
}

/*
 * "Not recorded" is not zero.
 *
 * A student for whom no register has ever been marked has `attendance: null`.
 * parseAttendance() turns that into 0, which averages them in as if they had
 * attended nothing and files them under "below 75%". Three students in this
 * database are in that position. Every report below counts only the students
 * who have a figure, and says how many it left out.
 */
function recordedAttendance(students) {
  return students.filter((s) => s.attendance !== null && s.attendance !== undefined && s.attendance !== '');
}

// ─── Student ID Cards ────────────────────────────────────────────────────
export function generateIDCards(students) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const margin = 10;
  const cardWidth = 86;
  const cardHeight = 54;
  const cols = 2;
  const gapX = 6;
  const gapY = 6;

  students.forEach((student, idx) => {
    if (idx > 0 && idx % 10 === 0) doc.addPage();
    const posInPage = idx % 10;
    const col = posInPage % cols;
    const row = Math.floor(posInPage / cols);
    const x = margin + col * (cardWidth + gapX);
    const y = margin + row * (cardHeight + gapY);
    drawIDCard(doc, x, y, cardWidth, cardHeight, student);
  });

  doc.save('student-id-cards.pdf');
}

function drawIDCard(doc, x, y, w, h, student) {
  doc.setFillColor(240, 240, 245);
  roundedRect(doc, x + 0.5, y + 0.5, w, h, 3);
  doc.fill();
  doc.setFillColor(255, 255, 255);
  roundedRect(doc, x, y, w, h, 3);
  doc.fill();
  doc.setFillColor(...INSTITUTE.primaryColor);
  roundedRect(doc, x, y, w, 8, 3);
  doc.fill();
  doc.rect(x, y + 4, w, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(INSTITUTE.name, x + w / 2, y + 5.5, { align: 'center' });

  const circleX = x + 12;
  const circleY = y + 22;
  doc.setFillColor(...INSTITUTE.accentColor);
  doc.circle(circleX, circleY, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  const initials = student.name
    ? student.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
    : 'ST';
  doc.text(initials, circleX, circleY + 2, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(student.name || 'N/A', x + 24, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  const details = [
    { label: 'Reg No.', value: student.regNo || student.id || 'N/A' },
    { label: 'Program', value: student.program || student.department || 'N/A' },
    { label: 'Batch', value: student.batch || student.year || 'N/A' },
    { label: 'Status', value: student.status || 'Active' },
  ];
  details.forEach((d, i) => {
    const dy = y + 23 + i * 6;
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(5);
    doc.text(d.label, x + 24, dy);
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(5.5);
    doc.text(d.value, x + 24, dy + 3);
  });
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(x + 4, y + h - 8, x + w - 4, y + h - 8);
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(4.5);
  doc.text(
    student.batch ? `Batch ${student.batch}` : 'AIMS Student Identity Card',
    x + w / 2, y + h - 4.5, { align: 'center' },
  );
}

// ─── Student List PDF ────────────────────────────────────────────────────
export function generateStudentList(students, title = 'Student Roster') {
  /*
   * LANDSCAPE, deliberately.
   *
   * Portrait A4 gives autoTable about 170mm of usable width, and this roster's
   * own content needs more than that before any styling is applied: a
   * registration number is 18 characters and a programme name reaches "BS
   * Electrical Engineering". autoTable reported the shortfall on every run and
   * resolved it by squeezing the Program column, which wrapped nearly every
   * programme onto two lines and doubled the page count.
   *
   * Landscape gives 297mm and the whole row fits on one line, so the document
   * is both correct and about half as long.
   */
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageWidth = 297;
  addHeader(doc, pageWidth, title);
  let y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 40);
  y = addInfoLine(doc, `Total Students: ${students.length}`, y);

  /*
   * Column widths sum to 169mm against a 182mm text column (A4 portrait, 210mm
   * wide, 14mm margins). autoTable's DEFAULT margin is wider than that, which
   * left the table 13mm over the printable width — it logged "13 units width
   * could not fit page" and silently squeezed the Program column, wrapping
   * every programme name onto two lines. Stating the margin fixes the arithmetic.
   *
   * `section` earns its place: two students in the same programme and batch sit
   * in different sections, and a printed roster is used to find one of them.
   */
  autoTable(doc, {
    head: [['#', 'Reg. No.', 'Name', 'Program', 'Batch', 'Sect.', 'Status']],
    body: students.map((s, i) => [
      (i + 1).toString(), s.regNo || s.id?.toString() || '-', s.name || 'N/A',
      s.program || s.department || 'N/A', s.batch || s.year || 'N/A',
      s.section || '-', s.status || 'Active',
    ]),
    startY: y + 2,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 7, cellPadding: 2.5, textColor: [15, 23, 42], overflow: 'ellipsize' },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    /*
     * Widths are left to autoTable, and only alignment is stated.
     *
     * Hardcoded `cellWidth` values were the original problem and could not be
     * the fix: the "could not fit page" warning measures the MINIMUM width the
     * content needs at the given font size, so declaring narrower columns made
     * the reported shortfall bigger, not smaller. Landscape plus auto-sizing
     * lets the library distribute the real 249mm across the seven columns
     * according to what each actually holds.
     */
    columnStyles: {
      0: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center' },
      6: { halign: 'center' },
    },
  });

  addFooter(doc, pageWidth);
  doc.save('student-list.pdf');
}

// ═══════════════════════════════════════════════════════════════════════════
//  REPORT GENERATORS — All compute from the ACTUAL 44 students array
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. Attendance Report ────────────────────────────────────────────────
export function generateAttendanceReport(students) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  addHeader(doc, pageWidth, 'Attendance Report');

  // Only students who HAVE an attendance figure. Averaging in the ones with no
  // register marked would drag the institute average down with zeroes that
  // represent missing data rather than missed classes.
  const total = students.length;
  const recorded = recordedAttendance(students);
  const unrecorded = total - recorded.length;
  const avgAttendance = recorded.length
    ? recorded.reduce((sum, s) => sum + parseAttendance(s.attendance), 0) / recorded.length
    : 0;
  const atRiskStudents = recorded.filter(s => parseAttendance(s.attendance) < 75);

  // Program-wise attendance, over the recorded students only.
  const progMap = {};
  recorded.forEach(s => {
    const prog = s.program || 'Unknown';
    if (!progMap[prog]) progMap[prog] = { students: 0, totalAtt: 0 };
    progMap[prog].students++;
    progMap[prog].totalAtt += parseAttendance(s.attendance);
  });

  let y = 40;
  y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, y);
  y = addInfoLine(doc, `Overall Attendance: ${recorded.length ? `${avgAttendance.toFixed(1)}%` : 'No registers marked'}`, y);
  y = addInfoLine(doc, `Total Students: ${total}`, y + 2);
  y = addInfoLine(doc, `Attendance recorded for: ${recorded.length}${unrecorded ? ` (${unrecorded} student(s) have no register marked and are excluded)` : ''}`, y);

  // Program-wise table
  autoTable(doc, {
    head: [['Program', 'Students', 'Avg Attendance']],
    body: Object.entries(progMap).map(([prog, data]) => [
      prog, data.students.toString(), `${(data.totalAtt / data.students).toFixed(1)}%`,
    ]),
    startY: y + 4,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // At-risk students
  y = doc.lastAutoTable.finalY + 10;
  doc.setTextColor(153, 27, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Students at Risk (Below 75%) — ${atRiskStudents.length} student(s)`, 14, y);
  y += 4;

  if (atRiskStudents.length > 0) {
    autoTable(doc, {
      head: [['Name', 'Reg No.', 'Program', 'Attendance', 'Batch']],
      body: atRiskStudents.map(s => [
        s.name, s.regNo || '-', s.program || 'N/A', `${parseAttendance(s.attendance).toFixed(1)}%`, s.batch || 'N/A',
      ]),
      startY: y + 2,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
      headStyles: { fillColor: [153, 27, 27], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [255, 245, 245] },
    });
  } else {
    y += 2;
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('✓ No students below 75% attendance threshold.', 14, y);
  }

  addFooter(doc, pageWidth);
  doc.save('attendance-report.pdf');
}

// ─── 2. Fee Report ───────────────────────────────────────────────────────
export function generateFeeReport(students) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  addHeader(doc, pageWidth, 'Fee Collection Report');

  /*
   * The four statuses the API actually emits: Paid, Partial, Unpaid, Overdue.
   *
   * This filtered on `'Pending'`, a value the fee module has never returned, so
   * that bucket was always empty — and Partial and Unpaid students fell into
   * none of the three counted groups. The header line therefore reported
   * numbers that did not add up to the roll it was describing.
   *
   * Outstanding money is `remainingBalance`, not the full `feeAmount`: a
   * student who has paid four fifths of their voucher does not owe all of it.
   */
  const billed = students.filter(s => s.feeStatus);
  const unbilled = students.length - billed.length;

  const totalCollection = billed.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
  const totalBilled = billed.reduce((sum, s) => sum + (s.feeAmount || 0), 0);
  const totalOutstanding = billed.reduce((sum, s) => sum + (s.remainingBalance || 0), 0);

  const byStatus = (status) => billed.filter(s => s.feeStatus === status);
  const paidStudents = byStatus('Paid');
  const partialStudents = byStatus('Partial');
  const unpaidStudents = byStatus('Unpaid');
  const overdueStudents = byStatus('Overdue');

  // Group by program for fee distribution — billed students only, or a
  // programme's collection rate is divided by a roll that includes people who
  // were never invoiced.
  const progFee = {};
  billed.forEach(s => {
    const prog = s.program || 'Unknown';
    if (!progFee[prog]) progFee[prog] = { total: 0, collected: 0, count: 0 };
    progFee[prog].total += s.feeAmount || 0;
    progFee[prog].collected += s.paidAmount || 0;
    progFee[prog].count++;
  });

  const collectionRate = totalBilled > 0 ? (totalCollection / totalBilled) * 100 : 0;

  let y = 40;
  y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, y);
  y = addInfoLine(doc, `Billed Students: ${billed.length} of ${students.length}${unbilled ? ` (${unbilled} not billed)` : ''}`, y + 2);
  y = addInfoLine(doc, `Paid: ${paidStudents.length}  |  Partial: ${partialStudents.length}  |  Unpaid: ${unpaidStudents.length}  |  Overdue: ${overdueStudents.length}`, y);
  y = addInfoLine(doc, `Total Billed: ${formatMoney(totalBilled)}`, y);
  y = addInfoLine(doc, `Total Collected: ${formatMoney(totalCollection)} (${collectionRate.toFixed(1)}%)`, y);
  y = addInfoLine(doc, `Total Outstanding: ${formatMoney(totalOutstanding)}`, y);

  // Program-wise fee table. The collection rate is money collected over money
  // billed — it was head-count of fully-paid students over ALL students, two
  // different quantities under one label.
  autoTable(doc, {
    head: [['Program', 'Students', `Billed (${currencySymbol()})`, `Collected (${currencySymbol()})`, 'Rate']],
    body: Object.entries(progFee).map(([prog, data]) => [
      prog, data.count.toString(),
      formatMoney(data.total),
      formatMoney(data.collected),
      data.total > 0 ? `${((data.collected / data.total) * 100).toFixed(1)}%` : '—',
    ]),
    startY: y + 4,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  /*
   * Everyone who still owes money — Overdue first, since that is the list this
   * report is generated to act on, then Unpaid, then Partial.
   *
   * This was `[...pendingStudents, ...overdueStudents]`, and `pendingStudents`
   * was always empty, so the 787 students part-way through paying never
   * appeared on the chase list at all.
   */
  const nonPaid = [...overdueStudents, ...unpaidStudents, ...partialStudents];
  if (nonPaid.length > 0) {
    y = doc.lastAutoTable.finalY + 10;
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Outstanding Payments — ${nonPaid.length} student(s)`, 14, y);
    y += 4;

    autoTable(doc, {
      // Billed AND still owed: on a Partial row those differ, and the amount
      // worth chasing is the balance.
      head: [['Name', 'Reg No.', 'Program', `Billed (${currencySymbol()})`, `Owed (${currencySymbol()})`, 'Due Date', 'Status']],
      body: nonPaid.map(s => [
        s.name, s.regNo || '-', s.program || 'N/A',
        formatMoney(s.feeAmount || 0),
        formatMoney(s.remainingBalance || 0),
        s.feeDueDate || s.dueDate || 'Not set', s.feeStatus,
      ]),
      startY: y + 2,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
      headStyles: { fillColor: [153, 27, 27], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [255, 245, 245] },
    });
  }

  addFooter(doc, pageWidth);
  doc.save('fee-report.pdf');
}

// ─── 3. Exam Report ──────────────────────────────────────────────────────
export function generateExamReport(students) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  addHeader(doc, pageWidth, 'Examination Report');

  // Results come from the published CGPA. aims_db stores no per-student exam
  // percentage, so the old `s.examScore || 0` reported every student as 0% and
  // failed. Students with no published result are excluded rather than counted
  // as a zero.
  const graded = students.filter(s => s.cgpa != null);
  const avgCgpa = graded.length > 0
    ? graded.reduce((a, s) => a + s.cgpa, 0) / graded.length
    : 0;
  const passed = graded.filter(s => s.cgpa >= PASS_GPA).length;
  const passRate = graded.length > 0 ? (passed / graded.length) * 100 : 0;
  const distinction = graded.filter(s => s.cgpa >= 3.5).length;
  const failed = graded.filter(s => s.cgpa < PASS_GPA).length;

  // Grade distribution, on the 4.0 scale
  const grades = ['A', 'A-', 'B+', 'B', 'B-', 'C', 'D', 'F'];
  const gradeCount = {};
  grades.forEach(g => gradeCount[g] = 0);
  graded.forEach(s => {
    const g = s.examGrade || gradeFromGpa(s.cgpa);
    if (g) gradeCount[g] = (gradeCount[g] || 0) + 1;
  });

  // Program performance
  const progExam = {};
  graded.forEach(s => {
    const prog = s.program || 'Unknown';
    if (!progExam[prog]) progExam[prog] = { totalScore: 0, passed: 0, count: 0 };
    progExam[prog].totalScore += s.cgpa;
    progExam[prog].count++;
    if (s.cgpa >= PASS_GPA) progExam[prog].passed++;
  });

  let y = 40;
  y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, y);
  y = addInfoLine(doc, `Students with a published result: ${graded.length} of ${students.length}`, y + 2);
  y = addInfoLine(doc, `Average CGPA: ${avgCgpa.toFixed(2)} / 4.00`, y);
  y = addInfoLine(doc, `Pass Percentage: ${passRate.toFixed(1)}%`, y);
  y = addInfoLine(doc, `Distinction (CGPA >= 3.5): ${distinction}  |  Below ${PASS_GPA.toFixed(1)}: ${failed}`, y);

  // Grade distribution
  autoTable(doc, {
    head: [['Grade', 'Students', 'Percentage']],
    body: grades.map(g => [
      g, (gradeCount[g] || 0).toString(),
      students.length > 0 ? `${((gradeCount[g] || 0) / students.length * 100).toFixed(1)}%` : '0%',
    ]),
    startY: y + 4,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // Program performance
  y = doc.lastAutoTable.finalY + 10;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Program-wise Performance', 14, y);
  y += 4;

  autoTable(doc, {
    head: [['Program', 'Average CGPA', 'Pass Rate']],
    body: Object.entries(progExam).map(([prog, data]) => [
      prog, (data.totalScore / data.count).toFixed(2),
      `${((data.passed / data.count) * 100).toFixed(1)}%`,
    ]),
    startY: y + 2,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // Failed students list
  const failedStudents = graded.filter(s => s.cgpa < PASS_GPA);
  y = doc.lastAutoTable.finalY + 10;
  if (failedStudents.length > 0) {
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Failed Students — ${failedStudents.length} student(s)`, 14, y);
    y += 4;

    autoTable(doc, {
      head: [['Name', 'Reg No.', 'Program', 'CGPA', 'Grade']],
      body: failedStudents.map(s => [
        s.name, s.regNo || '-', s.program || 'N/A',
        s.cgpa.toFixed(2), s.examGrade || gradeFromGpa(s.cgpa) || '-',
      ]),
      startY: y + 2,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
      headStyles: { fillColor: [153, 27, 27], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [255, 245, 245] },
    });
  } else {
    doc.setTextColor(5, 150, 105);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('✓ No students failed.', 14, y);
  }

  addFooter(doc, pageWidth);
  doc.save('exam-report.pdf');
}

// ─── 4. Enrollment Report ────────────────────────────────────────────────
export function generateEnrollmentReport(students) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  addHeader(doc, pageWidth, 'Enrollment Report');

  // Aggregate from actual students
  const progMap = {};
  const batchMap = {};
  let active = 0, inactive = 0;
  students.forEach(s => {
    const prog = s.program || 'Unknown';
    progMap[prog] = (progMap[prog] || 0) + 1;
    const batch = s.batch || 'Unknown';
    batchMap[batch] = (batchMap[batch] || 0) + 1;
    if (s.status === 'Active') active++;
    else inactive++;
  });

  let y = 40;
  y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, y);
  y = addInfoLine(doc, `Total Enrolled: ${students.length} (${active} Active, ${inactive} Inactive)`, y + 2);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Program-wise Enrollment', 14, y + 2);
  y += 6;

  autoTable(doc, {
    head: [['Program', 'Students']],
    body: Object.entries(progMap).map(([prog, count]) => [prog, count.toString()]),
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  y = doc.lastAutoTable.finalY + 10;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Batch-wise Enrollment', 14, y);
  y += 4;

  autoTable(doc, {
    head: [['Batch', 'Students']],
    body: Object.entries(batchMap).map(([batch, count]) => [batch, count.toString()]),
    startY: y + 2,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  addFooter(doc, pageWidth);
  doc.save('enrollment-report.pdf');
}

// ─── 5. Faculty Report ───────────────────────────────────────────────────
export function generateFacultyReport(faculty) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  addHeader(doc, pageWidth, 'Faculty Performance Report');

  let y = 40;
  y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, y);
  y = addInfoLine(doc, `Total Faculty: ${faculty.length}`, y + 2);

  // Columns are the teaching load actually recorded in vw_teacher_workload.
  // The report used to print "Experience" and a "Rating" out of 5; aims_db
  // stores neither, so both were invented numbers on an official-looking PDF.
  autoTable(doc, {
    head: [['Name', 'Department', 'Designation', 'Subjects', 'Sections', 'Weekly Hours']],
    body: faculty.map(f => [
      f.name || '—',
      f.department || '—',
      f.designation || '—',
      f.subjects != null ? String(f.subjects) : '—',
      f.sections != null ? String(f.sections) : '—',
      f.weeklyHours != null ? String(f.weeklyHours) : '—',
    ]),
    startY: y + 4,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [15, 23, 42] },
    headStyles: { fillColor: INSTITUTE.primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  addFooter(doc, pageWidth);
  doc.save('faculty-report.pdf');
}

// ─── 6. AI Analytics Report ──────────────────────────────────────────────
export function generateAIAnalyticsReport(students) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = 210;
  addHeader(doc, pageWidth, 'AI Performance Report');

  /*
   * At-risk, from the columns that exist.
   *
   * Two corrections. `feeStatus === 'Pending'` never matched — the fee module
   * emits Unpaid and Partial, not Pending — so the fee half of the test was
   * dead and only Overdue ever counted. And a student with NO attendance
   * recorded scored 0% here, which put every unmarked student at the top of
   * the risk list ahead of students who are genuinely failing.
   */
  const hasAttendance = (s) => s.attendance !== null && s.attendance !== undefined && s.attendance !== '';
  const lowAttendance = (s) => hasAttendance(s) && parseAttendance(s.attendance) < 75;
  const owesMoney = (s) => s.feeStatus === 'Overdue' || s.feeStatus === 'Unpaid';

  const atRisk = students.filter(s => {
    const failedExam = s.cgpa != null && s.cgpa < PASS_GPA;
    return lowAttendance(s) || (owesMoney(s) && failedExam);
  });

  // Risk factor calculation
  const atRiskDetailed = atRisk.map(s => {
    const att = parseAttendance(s.attendance);
    let riskScore = 0;
    const reasons = [];
    if (lowAttendance(s)) { riskScore += 40; reasons.push(`Low attendance (${att.toFixed(1)}%)`); }
    if (s.feeStatus === 'Overdue') { riskScore += 30; reasons.push('Fee overdue'); }
    else if (s.feeStatus === 'Unpaid') { riskScore += 15; reasons.push('Fee unpaid'); }
    else if (s.feeStatus === 'Partial') { riskScore += 8; reasons.push('Fee part-paid'); }
    if (s.cgpa != null && s.cgpa < PASS_GPA) { riskScore += 30; reasons.push(`CGPA ${s.cgpa.toFixed(2)}`); }
    return { ...s, riskScore: Math.min(riskScore, 100), reasons: reasons.join('; ') };
  }).sort((a, b) => b.riskScore - a.riskScore);

  // Averaged over students who HAVE a figure, not over the whole roll.
  const recorded = recordedAttendance(students);
  const avgAtt = recorded.length > 0
    ? (recorded.reduce((sum, s) => sum + parseAttendance(s.attendance), 0) / recorded.length)
    : 0;
  const shortageCount = students.filter(s => parseAttendance(s.attendance) < 75).length;
  const failedCount = students.filter(s => s.cgpa != null && s.cgpa < PASS_GPA).length;
  const overdueCount = students.filter(s => s.feeStatus === 'Overdue').length;
  const pendingCount = students.filter(s => s.feeStatus === 'Pending').length;

  let y = 40;
  y = addInfoLine(doc, `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, y);
  y = addInfoLine(doc, `At-Risk Students Identified: ${atRiskDetailed.length} out of ${students.length}`, y + 2);
  y = addInfoLine(doc, `Avg Attendance: ${avgAtt.toFixed(1)}% (${shortageCount} below 75%)`, y);
  y = addInfoLine(doc, `Fee Issues: ${overdueCount} Overdue + ${pendingCount} Pending`, y);
  y = addInfoLine(doc, `Failed Exams: ${failedCount} student(s)`, y);

  // At-risk table
  if (atRiskDetailed.length > 0) {
    doc.setTextColor(153, 27, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('At-Risk Students (AI Detection)', 14, y + 4);
    y += 8;

    autoTable(doc, {
      head: [['Name', 'Reg No.', 'Program', 'Risk', 'Attendance', 'Fee', 'Exam', 'Key Reason']],
      body: atRiskDetailed.map(s => [
        s.name, s.regNo || '-', s.program || 'N/A', `${s.riskScore}%`,
        `${parseAttendance(s.attendance).toFixed(1)}%`, s.feeStatus || 'N/A',
        s.cgpa != null ? s.cgpa.toFixed(2) : '-', s.reasons.substring(0, 40),
      ]),
      startY: y,
      theme: 'grid',
      styles: { fontSize: 6.5, cellPadding: 2, textColor: [15, 23, 42] },
      headStyles: { fillColor: [153, 27, 27], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5 },
      alternateRowStyles: { fillColor: [255, 245, 245] },
    });

    y = doc.lastAutoTable.finalY + 10;
  } else {
    y += 6;
  }

  // Recommendations based on actual data
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('AI Recommendations', 14, y);
  y += 4;

  const recommendations = [];
  if (shortageCount > 0) recommendations.push(`Set up intervention program for ${shortageCount} students with <75% attendance`);
  if (overdueCount > 0) recommendations.push(`Send fee reminders to ${overdueCount} students with overdue payments`);
  if (failedCount > 0) recommendations.push(`Provide remedial classes for ${failedCount} students who failed the exam`);
  if (pendingCount > 0) recommendations.push(`Follow up with ${pendingCount} students on pending fee payments`);
  recommendations.push('Review academic progress of at-risk students weekly');
  if (students.filter(s => s.status === 'Inactive').length > 0) {
    recommendations.push(`Reach out to ${students.filter(s => s.status === 'Inactive').length} inactive students for status update`);
  }

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  recommendations.forEach((rec, i) => {
    doc.text(`${i + 1}. ${rec}`, 18, y);
    y += 5;
  });

  addFooter(doc, pageWidth);
  doc.save('ai-analytics-report.pdf');
}
