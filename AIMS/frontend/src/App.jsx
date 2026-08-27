import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ErrorBoundary from './components/common/ErrorBoundary';
import ProtectedRoute, { ForcedPasswordChangeRoute } from './components/common/ProtectedRoute';
import { SkeletonPage } from './components/common/Skeleton';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { AuthProvider } from './context/AuthContext';
import { ChatbotProvider } from './context/ChatbotContext';
import { ThemeProvider } from './context/ThemeContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { AuthProvider as FacultyAuthProvider } from './context/FacultyAuthContext';
import { DataProvider as FacultyDataProvider } from './context/FacultyDataContext';
import { FacultyBadgeProvider } from './context/FacultyBadgeContext';
/*
 * THE PROVIDER THAT WAS NEVER MOUNTED.
 *
 * Ten faculty screens call `showToast()` — 32 call sites, covering every save,
 * every failed save and every export on the portal. `useToast()` falls back to
 * the context's default value when no provider is above it, and that default is
 * `() => {}`, so all thirty-two were silently doing nothing: no confirmation
 * that a marks sheet had been saved, and — worse — no message when a save was
 * REJECTED by the server. Found with Playwright, waiting on `.toast-item` after
 * a save that the server had definitely accepted; it never appeared, because
 * nothing was ever rendering it.
 *
 * It goes here rather than inside a screen so a toast raised on one route is
 * not unmounted by navigating away mid-request, and so the stack is shared —
 * two screens cannot each render their own overlapping corner.
 */
import { ToastProvider } from './components/faculty/Toast.jsx';
import { StudentProfileProvider } from './context/StudentProfileContext';
import AssistantWidget from './components/common/AssistantWidget';
import { ADMIN_PATHS } from './pages/admin/adminNav';
import {
  ParentAttendanceRoute, ParentTimetableRoute, ParentResultsRoute,
  ParentFeesRoute, ParentNotificationsRoute, ParentProfileRoute,
} from './pages/parent/parentViewRoutes';

// ---- Welcome / portal chooser / admin & parent (Vite, React 19) ----
const Welcome = lazy(() => import('./pages/Welcome'));
const ChoosePortal = lazy(() => import('./pages/ChoosePortal'));
const SignIn = lazy(() => import('./pages/SignIn'));
const AdminSignup = lazy(() => import('./pages/AdminSignup'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const ParentDashboard = lazy(() => import('./pages/parent/ParentDashboard'));

/* ---- Parent portal (was one route with its modules in useState) ----
 *
 * Split into a route per module so a notification can link to a screen, Back
 * works, and the child in view is addressable as ?child=. The shell is
 * ParentLayout; the module list it and this router are both built from is
 * pages/parent/parentNav.js, so the sidebar and the router cannot disagree
 * about which modules exist. They did: the old ?tab= whitelist was missing
 * `my-children`.
 */
const ParentLayout = lazy(() => import('./pages/parent/ParentLayout'));
const ParentOverview = lazy(() => import('./pages/parent/ParentOverviewPage'));
const ParentMyChildren = lazy(() => import('./pages/parent/MyChildrenPage'));

// ---- Faculty portal (originally its own Vite app) ----
const FacultyDashboard = lazy(() => import('./pages/faculty/FacultyDashboard'));
const FacultyMyClasses = lazy(() => import('./pages/faculty/MyClasses'));
const FacultyStudents = lazy(() => import('./pages/faculty/Students'));
const FacultyStudentAttendance = lazy(() => import('./pages/faculty/StudentAttendance'));
const FacultyMarks = lazy(() => import('./pages/faculty/Marks'));
const FacultyAssignments = lazy(() => import('./pages/faculty/Assignments'));
const FacultyAnnouncements = lazy(() => import('./pages/faculty/Announcements'));
const FacultyReports = lazy(() => import('./pages/faculty/Reports'));
const FacultyAIAnalytics = lazy(() => import('./pages/faculty/AIAnalytics'));
const FacultyTimetable = lazy(() => import('./pages/faculty/TeacherTimetable'));
const FacultyUsers = lazy(() => import('./pages/faculty/Users'));
const FacultyProfile = lazy(() => import('./pages/faculty/Profile'));
const FacultySettings = lazy(() => import('./pages/faculty/Settings'));
const FacultyNotifications = lazy(() => import('./pages/faculty/Notifications'));
const FacultyNotFound = lazy(() => import('./pages/faculty/NotFound'));

// ---- Student portal (originally CRA, React 18) ----
const StudentPortal = lazy(() => import('./pages/student/StudentPortal'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentMyCourses = lazy(() => import('./pages/student/MyCourses'));
const StudentAttendance = lazy(() => import('./pages/student/Attendance'));
const StudentResult = lazy(() => import('./pages/student/Result'));
const StudentFeeManagement = lazy(() => import('./pages/student/FeeManagement'));
const StudentTimeTable = lazy(() => import('./pages/student/TimeTable'));
const StudentDocument = lazy(() => import('./pages/student/Document'));
const StudentProfile = lazy(() => import('./pages/student/Profile'));
const StudentCourseDetails = lazy(() => import('./pages/student/CourseDetails'));
const StudentNotifications = lazy(() => import('./pages/student/Notifications'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
// Forced first sign-in password change for admin-issued accounts.
const ChangePassword = lazy(() => import('./pages/ChangePassword'));

/*
 * The fallback while a lazily loaded route's chunk is in flight.
 *
 * It was a red ring spinning in the middle of an empty page with the word
 * "Loading..." under it. Two problems: it told you nothing about what was
 * arriving, and it left the viewport blank, so every navigation was a flash of
 * emptiness followed by a whole page appearing at once.
 *
 * A page-shaped skeleton holds the space instead. The router knows which URL is
 * loading, but the component that knows its layout is exactly the thing that
 * has not been fetched yet — so this is the generic shape (banner, stat tiles,
 * table), which is what most screens in this product are.
 */
function PageLoader() {
  return <SkeletonPage />;
}

const S = ({ children }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>;

/**
 * An error boundary that clears itself when the route changes.
 *
 * The outer boundary below wraps the whole app, so a throw on one page used to
 * replace every portal with the error screen and keep it there — navigating to
 * another tab could not clear it, because nothing ever reset the boundary's
 * state. Feeding it the pathname means moving to a different page recovers.
 *
 * It has to live inside <BrowserRouter> to read the location, which is why it
 * is a separate component rather than the outer boundary.
 */
function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

/*
 * /student-profile/42 -> /students/42.
 *
 * <Navigate> cannot carry a path parameter through on its own, so the id is
 * read here and put into the new address. Kept as a redirect rather than a
 * second live route so there is one URL for a profile, not two that drift.
 */
function LegacyStudentProfileRedirect() {
  const { studentId } = useParams();
  return <Navigate to={studentId ? `/students/${studentId}` : '/students'} replace />;
}

// Every admin URL renders the same shell, which picks its view from the path.
const Admin = () => (
  <ProtectedRoute portal="admin">
    <S><AdminDashboard /></S>
  </ProtectedRoute>
);

// Student pages all need the profile provider as well as the guard.
const Student = ({ children }) => (
  <ProtectedRoute portal="student">
    <StudentProfileProvider>{children}</StudentProfileProvider>
  </ProtectedRoute>
);

export default function App() {
  return (
    <ErrorBoundary>
      {/*
        * The shared server-state cache, outermost of the data providers.
        *
        * Above AuthProvider on purpose: signing out has to be able to empty
        * the cache, and a provider cannot clear a client it sits inside.
        * Below ErrorBoundary so a render fault is still caught.
        */}
      <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            {/* Inside ThemeProvider: the stored Appearance preference is
                pushed into it once the account is known. */}
            <PreferencesProvider>
            <ChatbotProvider>
              <RouteErrorBoundary>
              <Routes>
              {/* Welcome / portal chooser */}
              <Route path="/" element={<S><Welcome /></S>} />
              <Route path="/choose-portal" element={<S><ChoosePortal /></S>} />
              <Route path="/sign-in/:portal" element={<S><SignIn /></S>} />
              <Route path="/sign-in" element={<S><SignIn /></S>} />
              <Route path="/forgot-password" element={<S><ForgotPassword /></S>} />
              {/* Where ProtectedRoute sends anyone still holding an
                  admin-issued password. Not portal-specific: students,
                  parents and teachers all land here.

                  Guarded, and it was not before. The screen answers one
                  outstanding request — "replace the password an admin issued
                  you" — so it is reachable only while that request is open.
                  Once it is answered the flag clears and this route sends the
                  user back to their portal, which is what stops the
                  notification that announces the change from re-opening the
                  form that made it. A routine change lives in each portal's
                  own profile instead. */}
              <Route
                path="/change-password"
                element={<ForcedPasswordChangeRoute><S><ChangePassword /></S></ForcedPasswordChangeRoute>}
              />
              {/* Admin auth — legacy URL redirect + signup */}
              <Route path="/admin-login" element={<Navigate to="/sign-in/admin" replace />} />
              <Route path="/admin-signup" element={<S><AdminSignup /></S>} />

              {/* Admin — one URL per module, generated from the single
                  navigation map so the sidebar and the router cannot disagree.
                  Every entry renders the same shell, which reads the module to
                  show from the path. See pages/admin/adminNav.js. */}
              {ADMIN_PATHS.map((path) => (
                <Route key={path} path={path} element={<Admin />} />
              ))}

              {/* A student's profile used to be a top-level module at
                  /student-profile with its own sidebar entry, which opened
                  showing "No student selected" because the sidebar had no
                  student to name. It now lives under the list it is reached
                  from, at /students/:studentId. These two keep anything already
                  bookmarked working. */}
              <Route path="/student-profile" element={<Navigate to="/students" replace />} />
              <Route path="/student-profile/:studentId" element={<LegacyStudentProfileRedirect />} />

              {/* Parent — the legacy single-route URL, kept as a redirect
                  that translates ?tab= into the route that now shows it. Nine
                  notification rows in the database still carry it, and
                  api/roles.js sends every parent here at sign-in. */}
              <Route
                path="/parent-dashboard"
                element={
                  <ProtectedRoute portal="parent">
                    <S><ParentDashboard /></S>
                  </ProtectedRoute>
                }
              />

              {/* Parent portal — one URL per module, under the shared shell.
                  Nested routes rather than a nested <Routes>, so the sidebar,
                  the child picker and the notification bell are not unmounted
                  and refetched on every navigation within the portal. */}
              <Route
                path="/parent"
                element={
                  <ProtectedRoute portal="parent">
                    <S><ParentLayout /></S>
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/parent/dashboard" replace />} />
                <Route path="dashboard" element={<S><ParentOverview /></S>} />
                <Route path="my-children" element={<S><ParentMyChildren /></S>} />
                <Route path="attendance" element={<S><ParentAttendanceRoute /></S>} />
                <Route path="timetable" element={<S><ParentTimetableRoute /></S>} />
                <Route path="results" element={<S><ParentResultsRoute /></S>} />
                <Route path="fees" element={<S><ParentFeesRoute /></S>} />
                <Route path="notifications" element={<S><ParentNotificationsRoute /></S>} />
                <Route path="profile" element={<S><ParentProfileRoute /></S>} />
                {/* An unknown parent URL goes to the portal's front page
                    rather than to the app-wide catch-all, which would sign the
                    parent out of their own portal to the landing screen. */}
                <Route path="*" element={<Navigate to="/parent/dashboard" replace />} />
              </Route>

              {/* Faculty portal */}
              <Route path="/faculty-dashboard" element={<Navigate to="/faculty/dashboard" replace />} />
              {/* The faculty portal had its own second login page. There is now
                  one real JWT sign-in for every role, so both old faculty login
                  URLs point at it. */}
              <Route path="/faculty-login" element={<Navigate to="/sign-in/faculty" replace />} />
              <Route path="/faculty/login" element={<Navigate to="/sign-in/faculty" replace />} />
              <Route
                path="/faculty/*"
                element={
                  <ProtectedRoute portal="faculty">
                    <FacultyAuthProvider>
                    <FacultyDataProvider>
                    <FacultyBadgeProvider>
                    <ToastProvider>
                      <Routes>
                        <Route path="" element={<Navigate to="dashboard" replace />} />
                        <Route path="dashboard" element={<S><FacultyDashboard /></S>} />
                        <Route path="my-classes" element={<S><FacultyMyClasses /></S>} />
                        <Route path="my-classes/:subjectId/:sectionId" element={<S><FacultyMyClasses /></S>} />
                        <Route path="students" element={<S><FacultyStudents /></S>} />
                        <Route path="attendance" element={<S><FacultyStudentAttendance /></S>} />
                        <Route path="marks" element={<S><FacultyMarks /></S>} />
                        <Route path="assignments" element={<S><FacultyAssignments /></S>} />
                        <Route path="announcements" element={<S><FacultyAnnouncements /></S>} />
                        <Route path="reports" element={<S><FacultyReports /></S>} />
                        <Route path="ai-analytics" element={<S><FacultyAIAnalytics /></S>} />
                        <Route path="timetable" element={<S><FacultyTimetable /></S>} />
                        <Route path="users" element={<S><FacultyUsers /></S>} />
                        <Route path="profile" element={<S><FacultyProfile /></S>} />
                        <Route path="settings" element={<S><FacultySettings /></S>} />
                        <Route path="notifications" element={<S><FacultyNotifications /></S>} />
                        <Route path="*" element={<S><FacultyNotFound /></S>} />
                      </Routes>
                    </ToastProvider>
                    </FacultyBadgeProvider>
                    </FacultyDataProvider>
                    </FacultyAuthProvider>
                  </ProtectedRoute>
                }
              />

              {/* Student portal — the standalone student login is replaced by
                  the shared JWT sign-in, same as faculty. */}
              <Route path="/student-login" element={<Navigate to="/sign-in/student" replace />} />
              <Route path="/student/login" element={<Navigate to="/sign-in/student" replace />} />
              <Route path="/student-dashboard" element={
                <Student><S><StudentDashboard /></S></Student>
              } />
              <Route
                path="/student/*"
                element={
                  <Student>
                    <Routes>
                      <Route path="" element={<S><StudentDashboard /></S>} />
                      <Route path="dashboard" element={<S><StudentDashboard /></S>} />
                      <Route path="my-courses" element={<S><StudentMyCourses /></S>} />
                      <Route path="my-courses/:courseCode" element={<S><StudentCourseDetails /></S>} />
                      <Route path="attendance" element={<S><StudentAttendance /></S>} />
                      <Route path="result" element={<S><StudentResult /></S>} />
                      <Route path="fee-management" element={<S><StudentFeeManagement /></S>} />
                      <Route path="time-table" element={<S><StudentTimeTable /></S>} />
                      <Route path="document" element={<S><StudentDocument /></S>} />
                      <Route path="profile" element={<S><StudentProfile /></S>} />
                      <Route path="notifications" element={<S><StudentNotifications /></S>} />
                      <Route path="*" element={<S><StudentDashboard /></S>} />
                    </Routes>
                  </Student>
                }
              />

              {/* Standalone Student sub-routes compatibility */}
              <Route path="/my-courses" element={<Student><S><StudentMyCourses /></S></Student>} />
              <Route path="/my-courses/:courseCode" element={<Student><S><StudentCourseDetails /></S></Student>} />
              <Route path="/result" element={<Student><S><StudentResult /></S></Student>} />
              <Route path="/time-table" element={<Student><S><StudentTimeTable /></S></Student>} />
              <Route path="/document" element={<Student><S><StudentDocument /></S></Student>} />
              <Route path="/profile" element={<Student><S><StudentProfile /></S></Student>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </RouteErrorBoundary>
            {/* Global AI assistant. Mounted once for every page, but it
                renders nothing for roles it does not serve — see
                ASSISTANT_ROLES in ChatbotContext. */}
            <AssistantWidget />
            </ChatbotProvider>
            </PreferencesProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
