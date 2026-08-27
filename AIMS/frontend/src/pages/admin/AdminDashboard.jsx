import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Header from '../../components/common/Header';
import Sidebar from '../../components/common/Sidebar';
import StudentsList from '../../components/admin/StudentsList';
import StudentProfile from '../../components/admin/StudentProfile';
import AttendanceView from '../../components/admin/AttendanceView';
import FeeManagementView from '../../components/admin/FeeManagementView';
import ExaminationView from '../../components/admin/ExaminationView';
import AIInsightsView from '../../components/admin/AIInsightsView';
import AIAnalytics from './AIAnalytics';
import ParentsManagement from '../../components/admin/ParentsManagement';
import NotificationsView from '../../components/admin/NotificationsView';
import AnnouncementsView from '../../components/admin/AnnouncementsView';
import UserManagement from '../../components/admin/UserManagement';
import FacultyView from '../../components/admin/FacultyView';
import AcademicStructureView from '../../components/admin/AcademicStructureView';
import TimetableManagement from '../../components/admin/TimetableManagement';
import TeacherQualifications from '../../components/admin/TeacherQualifications';
import EnrollmentExplorer from '../../components/admin/EnrollmentExplorer';
import StaffAccountsView from '../../components/admin/StaffAccountsView';
import AuditTrail from '../../components/admin/AuditTrail';
import DashboardHome from '../../components/admin/dashboard/DashboardHome';
import Reports from './Reports';
import Settings from './Settings';
import { tabForPath, canOpenModule } from './adminNav';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert } from 'lucide-react';
import { SURFACE, INK, SPACE, RULE, FONT } from '../../styles/adminTheme';

/*
 * The admin shell. Which module it renders is decided by the URL — see
 * pages/admin/adminNav.js. The effect that used to sync the path into a piece
 * of state is gone: the path IS the state now, read through tabForPath().
 */
export default function AdminDashboard() {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  const { user } = useAuth();
  const tab = tabForPath(location.pathname);

  const renderTabContent = () => {
    /*
     * A module this role cannot open is refused here rather than rendered.
     *
     * The sidebar already hides it, but a bookmark, a shared link or a typed
     * URL walks straight past the sidebar — and the screen underneath would
     * mount, fire its requests, collect 403s and settle on "Could not load",
     * which reads as a broken portal rather than as a permission boundary.
     */
    if (!canOpenModule(user?.roleId, tab)) {
      return (
        <div style={{
          backgroundColor: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0',
          padding: '3rem 2rem', textAlign: 'center', maxWidth: '520px', margin: '2rem auto',
        }}>
          <ShieldAlert size={32} style={{ color: '#B45309' }} />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A', margin: '0.75rem 0 0.35rem' }}>
            Not available for your role
          </h2>
          <p style={{ fontSize: '0.88rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
            Your account is a <strong>{user?.roleName}</strong> account, which does not
            have access to this module. Use the sidebar for what is available to you,
            or ask an administrator if you need this screen.
          </p>
        </div>
      );
    }

    switch (tab) {
      case 'students':         return <StudentsList />;
      case 'student-profile':  return <StudentProfile />;
      case 'attendance':       return <AttendanceView />;
      case 'fee-management':   return <FeeManagementView />;
      case 'examination':      return <ExaminationView />;
      case 'faculty':          return <FacultyView />;
      case 'qualifications':   return <TeacherQualifications />;
      case 'parents':          return <ParentsManagement />;
      case 'enrollment':       return <EnrollmentExplorer />;
      case 'academic-structure': return <AcademicStructureView />;
      case 'timetable':        return <TimetableManagement />;
      case 'staff-accounts':   return <StaffAccountsView />;
      case 'audit':            return <AuditTrail />;
      case 'ai-insights':      return <AIInsightsView />;
      case 'ai-ask':           return <AIAnalytics />;
      case 'reports':          return <Reports />;
      case 'notifications':    return <NotificationsView />;
      case 'announcements':    return <AnnouncementsView />;
      case 'settings':         return <Settings />;
      case 'users':
        return (
          <UserManagement
            showAddModal={showAddUserModal}
            onCloseAddModal={() => setShowAddUserModal(false)}
          />
        );
      case 'dashboard':
      default:
        return <DashboardHome />;
    }
  };

  const onDashboard = tab === 'dashboard';

  return (
    /*
     * `aims-dash` declares the dashboard's design tokens (see index.css). It
     * sits on the whole shell rather than on the dashboard alone so the tokens
     * are in scope for anything rendered inside it — but only the dashboard
     * route paints the warm canvas, because restyling every admin screen is
     * not what this change is.
     */
    <div className="aims-dash" style={{
      minHeight: '100dvh',
      backgroundColor: onDashboard ? SURFACE.canvas : '#F8FAFC',
      display: 'flex', flexDirection: 'column',
    }}>
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div style={{
        display: 'flex', flexDirection: 'column', flex: 1,
        minWidth: 0,
        // The sidebar's own width is now fluid (see styles/viewport.css), so
        // the gutter it leaves has to track it rather than restate 260px.
        marginLeft: isSidebarOpen ? 'var(--aims-sidebar-w, 260px)' : '0',
        transition: 'margin-left 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <Header onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

        {/* Each module below loads its own data when it opens. There is no
            portal-wide fetch here any more, so this shell renders immediately
            and a screen's spinner belongs to that screen alone.

            The dashboard is capped at 1440px and centred. Stat tiles stretched
            across a 2560px monitor put the four figures so far apart that they
            stop reading as one row, and a 13px feed line 2400px wide is past
            any comfortable measure. */}
        {/* Padding is expressed against the viewport rather than as a fixed
            step, so the gutters give ground on a smaller screen and the
            content keeps the space. SPACE.xxl stays the ceiling, so a large
            monitor is unchanged. */}
        <main style={{
          flex: 1, width: '100%',
          padding: onDashboard
            ? `clamp(1rem, 1.8vw, ${SPACE.xxl}) clamp(1rem, 1.8vw, ${SPACE.xxl})`
            : 'clamp(0.85rem, 1.4vw, 1.5rem) clamp(1rem, 1.8vw, 2rem)',
          maxWidth: onDashboard ? '1440px' : '100%',
          margin: onDashboard ? '0 auto' : undefined,
        }}>
          {renderTabContent()}
        </main>

        <footer style={{
          textAlign: 'center', padding: SPACE.xl,
          borderTop: `1px solid ${onDashboard ? RULE.hairline : '#E2E8F0'}`,
          fontFamily: FONT, fontSize: '12px',
          color: onDashboard ? INK.muted : '#94A3B8',
          backgroundColor: onDashboard ? 'transparent' : '#FFFFFF',
          marginTop: 'auto',
        }}>
          AIIMS · AI-Based Institute Management System v3.2.1 · © 2025 AIIMS. All rights reserved.
        </footer>
      </div>

      {showAddUserModal && tab !== 'users' && (
        <UserManagement showAddModal onCloseAddModal={() => setShowAddUserModal(false)} />
      )}
    </div>
  );
}
