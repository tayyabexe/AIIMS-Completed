const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const errorHandler = require("./middlewares/error.middleware");
const attachCurrency = require("./middlewares/currency.middleware");
const sanitizeRequest = require("./middlewares/sanitize.middleware");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const studentRoutes = require("./routes/studentRoutes");
const parentRoutes = require("./routes/parentRoutes");
const subjectRoutes = require("./routes/subjectRoutes");
/*
 * The academic structure — departments, programmes, batches, sections,
 * classrooms and semesters — is one module now rather than five routers and a
 * missing sixth. See routes/academicStructureRoutes.js: three of the five had
 * full CRUD with no authenticate() on them at all.
 */
const academics = require("./routes/academicStructureRoutes");
const timetableRoutes = require("./routes/timetableRoutes");
/*
 * Timetable management. Adds the layer the timetable was missing: a class
 * (course_offerings) that owns its teacher, its section and its subject, so a
 * timetable row is a *meeting* of a class rather than four independent facts
 * that nothing kept in step.
 */
const scheduleRoutes = require("./routes/courseOfferingRoutes");
const enrollmentRoutes = require("./routes/enrollmentRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const examRoutes = require("./routes/examRoutes");
const markRoutes = require("./routes/markRoutes");
const resultRoutes = require("./routes/resultRoutes");
const studentResultRoutes = require("./routes/studentResultRoutes");
const gpaRoutes = require("./routes/gpaRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const teacherSubjectRoutes = require("./routes/teacherSubjectRoutes");
const teacherAssignmentRoutes = require("./routes/teacherAssignmentRoutes");
const teacherProfileRoutes = require("./routes/teacherProfileRoutes");
const teacherDashboardRoutes = require("./routes/teacherDashboardRoutes");
const teacherScheduleRoutes = require("./routes/teacherScheduleRoutes");
// The teacher portal's own read/write surface (dashboard, classes, register).
const facultyPortalRoutes = require("./routes/facultyPortalRoutes");
// The admin portal's own read surface: one endpoint per screen.
const adminPortalRoutes = require("./routes/adminPortalRoutes");
const feeStructureRoutes = require("./routes/feeStructureRoutes");
const feeReportRoutes = require("./routes/feeReportRoutes");
// One fee module. See routes/feeRoutes.js - these two replace /api/student-fees,
// /api/challans, /api/receipts, /api/payments and the old /api/fee-payments.
const feeRoutes = require("./routes/feeRoutes");
const summaryRoutes = require("./routes/summaryRoutes");
const searchRoutes = require("./routes/searchRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const announcementRoutes = require("./routes/announcementRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");

const app = express();

// =====================
// Global Middleware
// =====================
// The browser rejects a wildcard origin on credentialed requests, so the
// frontend origins are listed explicitly. CORS_ORIGIN takes a comma-separated
// list; the Vite dev server defaults are used when it is not set.
const allowedOrigins = (process.env.CORS_ORIGIN ||
    "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(helmet({
    // Assets under /uploads are read cross-origin by the frontend.
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: (origin, callback) => {
        // Same-origin and non-browser callers (Postman, the test suites)
        // send no Origin header and must not be blocked.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // Resolve without the allow header rather than throwing, so a
        // disallowed origin is reported as 403 below and not as a 500.
        return callback(null, false);
    },
    credentials: true
}));

// cors() leaves disallowed origins unmarked; turn that into an explicit 403.
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origin && !allowedOrigins.includes(origin)) {
        return res.status(403).json({
            success: false,
            message: `Origin not allowed by CORS: ${origin}`
        });
    }

    next();
});

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
 * Immediately after the body parsers and before any router: every string on
 * the way in is edge-trimmed, so no controller, validator or service ever sees
 * " abdullah". Passwords and tokens are exempt — see the middleware.
 */
app.use(sanitizeRequest);

app.use(cookieParser());

// Uploaded student documents and profile pictures.
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// =====================
// Health Check Route
// =====================
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "AIMS Backend is Running Successfully"
    });
});

// =====================
// API Routes
// =====================
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/students", studentRoutes);
// Mounted under both spellings: the Postman collections call /api/parent
// while existing clients call /api/parents. Same router, so both stay in sync.
app.use("/api/parents", parentRoutes);
app.use("/api/parent", parentRoutes);
app.use("/api/subjects", subjectRoutes);

// The academic structure. Same URLs as before so nothing calling them breaks —
// what changed is that every one of them is now authenticated, validated, and
// refuses a delete while the row is still referenced.
app.use("/api/programs", academics.programs);
app.use("/api/batches", academics.batches);
app.use("/api/sections", academics.sections);
app.use("/api/semesters", academics.semesters);
// New: the rooms. These had no endpoint, so no screen could ever add one.
app.use("/api/classrooms", academics.classrooms);
// The whole tree with live counts, for the structure screen: GET /api/academics/overview.
app.use("/api/academics", academics.overview);
app.use("/api/timetables", timetableRoutes);

/*
 * The timetable management module.
 *
 * /api/timetables above is still the raw grid - it reads and writes rows.
 * These are the layer over it: the academic calendar, the classes that make up
 * a term, who teaches them, who is in them, and where each one can legally be
 * placed.
 *
 * Student classes are mounted onto /api/students rather than given their own
 * prefix, because "/api/students/:id/classes" is where a caller looks for a
 * student's classes. Mounted after studentRoutes so its own /:id handlers are
 * matched first; the paths do not overlap.
 */
app.use("/api/terms", scheduleRoutes.terms);
app.use("/api/offerings", scheduleRoutes.offerings);
app.use("/api/scheduling", scheduleRoutes.scheduling);
app.use("/api/students", scheduleRoutes.studentClasses);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/marks", markRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/student-results", studentResultRoutes);
app.use("/api/gpa", gpaRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/teacher-subjects", teacherSubjectRoutes);
app.use("/api/teacher-assignments", teacherAssignmentRoutes);
app.use("/api/teacher-profiles", teacherProfileRoutes);
app.use("/api/teacher-dashboard", teacherDashboardRoutes);
app.use("/api/teacher-schedules", teacherScheduleRoutes);

// Teacher portal. Everything here is scoped to the signed-in teacher's own
// timetable, so the portal no longer downloads whole tables and filters them
// in the browser.
app.use("/api/faculty", facultyPortalRoutes);

// Admin portal. Same principle as /api/faculty above: one endpoint per screen,
// each returning only that screen's own columns, filtered and paginated in SQL.
// This replaces the ten general-purpose list calls (3.04 MB) the portal used to
// make on every sign-in.
app.use("/api/admin", attachCurrency, adminPortalRoutes);

// Finance endpoints. attachCurrency adds { code: "PKR", symbol: "Rs.", ... }
// to each successful response so no portal has to assume a symbol - every
// amount in this system is Pakistani Rupees.
// The fee catalogue (what a programme/semester costs) is a separate concept
// from what a given student owes, so it is not consolidated.
app.use("/api/fee-structures", attachCurrency, feeStructureRoutes);
app.use("/api/fee-reports", attachCurrency, feeReportRoutes);

app.use("/api/fee-vouchers", attachCurrency, feeRoutes.vouchers);
app.use("/api/fee-payments", attachCurrency, feeRoutes.payments);

app.use("/api/departments", academics.departments);

// Role-scoped search. One endpoint for every portal: which resources it
// reaches and which rows come back are decided per role, not per route.
app.use("/api/search", searchRoutes);

// Read-only reporting views (aggregated in SQL, used by the dashboards).
app.use("/api/summaries", summaryRoutes);
app.use("/api/notifications", notificationRoutes);

// The announcements table has carried real rows since the database was seeded
// but had no API, which is why the faculty portal was rendering a hardcoded
// list. Non-admin callers are scoped to their own role's notices.
app.use("/api/announcements", announcementRoutes);

/*
 * The two AI services.
 *
 * These replace the single /api/assistant route, which combined document
 * lookup and database querying in one conversational loop. That design fed
 * query results back through the model and asked it to summarise them, which
 * is how a 1,175-row result came to be reported as 200: the backend applied a
 * LIMIT, counted the post-limit array, and instructed the model to state that
 * number as the total. The model was accurate about what it had been told.
 *
 * They are split because the two jobs want opposite things from a model.
 *
 *   /api/chatbot   - RAG over the AIMS documentation. May write prose freely;
 *                    the worst case is a clumsy explanation. Holds no database
 *                    tools, so there is nothing for a crafted question to reach.
 *
 *   /api/analytics - Question in, rows out. The model converts the question to
 *                    a query plan and stops. It never sees a result row, so it
 *                    cannot miscount, truncate, or generalise from a sample.
 *                    Rows travel to the browser and are rendered by fixed
 *                    templates.
 *
 * Both resolve scope server-side on every request and read through the same
 * SELECT-only database account.
 */
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/analytics", analyticsRoutes);

// =====================
// 404 Route
// =====================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route Not Found"
    });
});

// =====================
// Error Handler
// =====================
app.use(errorHandler);

module.exports = app;
