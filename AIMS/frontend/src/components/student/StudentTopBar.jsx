import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudentProfile } from '../../context/StudentProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useChatbot } from '../../context/ChatbotContext';
import NotificationBell from '../../components/common/NotificationBell';
import ProfileDropdown from '../../components/common/ProfileDropdown';
import PortalSearch from '../../components/common/PortalSearch';
import { PORTALS } from '../../api/roles';
import useServerNotifications from '../../api/notificationsData';
import { formatMoney } from '../../utils/currency';
import '../../components/common/TopNav.css';
import { IconMenu, IconSparkle } from './icons';

/**
 * Shared top navigation for every student page.
 * Always includes: chatbot button, notification bell, profile dropdown
 * (My Profile / Settings / Logout) — so students never need to return
 * to the dashboard just to log out.
 */
export default function StudentTopBar({ onMenuToggle, searchPlaceholder = 'Search or jump to a module...' }) {
  const navigate = useNavigate();
  const { profile, studentData } = useStudentProfile();
  const { logout } = useAuth();
  const { open: openChat, configure, isAvailable: assistantAvailable } = useChatbot();
  // The student's own rows from /api/notifications, scoped by the token.
  const { items, unreadCount, markRead, markAllRead } = useServerNotifications({ limit: 20 });

  /*
   * Offers the assistant the student's registered name — the same value the
   * dashboard card greets them with — once the profile has loaded.
   *
   * The portal is deliberately NOT passed. It is derived from the token in
   * ChatbotContext, so a header can no longer assert a role the backend does
   * not agree with. And an undefined `fullName` now clears the override
   * instead of leaving the previous account's name in place, which is what
   * greeted a student as "Admin2".
   */
  useEffect(() => {
    configure({ userName: profile.fullName });
  }, [configure, profile.fullName]);

  /**
   * The student's own records, searchable by any attribute that identifies
   * them: course code or title, timetable day/room/time, subject on a result,
   * challan or receipt number, document name or type.
   *
   * Everything here comes from studentData, which the backend already scopes
   * to this student, so the search can only ever surface their own rows.
   */
  const buildStudentResults = useCallback(
    (q) => {
      if (!studentData) return [];
      const needle = q.toLowerCase();
      const hit = (...fields) =>
        fields.some((f) => f != null && String(f).toLowerCase().includes(needle));

      const groups = [];
      const cap = 5;

      const courses = (studentData.courses || [])
        .filter((c) => hit(c.code, c.title, c.room, c.schedule, c.credits))
        .slice(0, cap)
        .map((c) => ({
          id: `course-${c.code}`,
          title: `${c.code || '—'} · ${c.title}`,
          subtitle: c.schedule,
          meta: c.credits ? `${c.credits} CH` : null,
          onSelect: () => navigate(`/student/my-courses/${encodeURIComponent(c.code)}`),
        }));
      if (courses.length) groups.push({ id: 'courses', label: 'My Courses', items: courses });

      const classes = (studentData.timetable || [])
        .filter((t) => hit(t.code, t.title, t.day, t.room, t.start, t.end))
        .slice(0, cap)
        .map((t) => ({
          id: `slot-${t.id}`,
          title: `${t.code || '—'} · ${t.title}`,
          subtitle: `${t.day} ${t.start}–${t.end} · ${t.room}`,
          onSelect: () => navigate('/student/time-table'),
        }));
      if (classes.length) groups.push({ id: 'timetable', label: 'Timetable', items: classes });

      const marks = (studentData.marks || [])
        .filter((m) => hit(m.subjectCode, m.subjectTitle, m.obtained, m.total))
        .slice(0, cap)
        .map((m) => ({
          id: `mark-${m.id}`,
          title: `${m.subjectCode || '—'} · ${m.subjectTitle}`,
          subtitle: m.obtained != null ? `${m.obtained}/${m.total ?? '—'}` : 'Not graded',
          onSelect: () => navigate('/student/result'),
        }));
      if (marks.length) groups.push({ id: 'results', label: 'Results', items: marks });

      /* Fee search runs off the derived voucher list rather than the raw
         `challans` / `receipts` rows. Two reasons: those rows were read with
         field names the API does not return (`challan_no`, `receipt_no`), so
         every result fell back to a bare row id — "Challan #3" — and the two
         sources put three different words for one document in front of the
         student. The portal names every fee document by its voucher number. */
      const feeData = studentData.fees;
      const money = [
        ...(feeData?.vouchers || []).map((v) => ({
          key: `voucher-${v.key}`,
          // `studentFeeId` and `challanId` were the two competing voucher keys
          // from the old five-table fee schema; there is one voucher id now.
          no: v.voucherNumber ?? `#${v.feeVoucherId}`,
          amount: v.amount,
          // Matches the voucher status vocabulary the API now uses.
          status: (v.due ?? 0) <= 0 ? 'Paid' : (v.paid > 0 ? 'Partial' : 'Unpaid'),
          label: 'Voucher',
          reference: null,
        })),
        ...(feeData?.transactions || []).map((t) => ({
          key: `payment-${t.id}`,
          no: t.voucherNumber ?? `#${t.feeVoucherId}`,
          amount: t.amount,
          status: 'Payment received',
          label: 'Payment against voucher',
          // Searchable, but not the title: a fee document is named by its
          // voucher number, so a receipt number beside it would read as a
          // second reference to a different thing.
          reference: t.receiptNumber ?? null,
        })),
      ]
        .filter((f) => hit(f.no, f.amount, f.status, f.label, f.reference))
        .slice(0, cap)
        .map((f) => ({
          id: `fee-${f.key}`,
          title: `${f.label} ${f.no ?? '—'}`,
          subtitle: f.status || '',
          meta: f.amount != null ? formatMoney(f.amount) : null,
          onSelect: () => navigate('/student/fee-management'),
        }));
      if (money.length) groups.push({ id: 'fees', label: 'Fee Management', items: money });

      return groups;
    },
    [studentData, navigate],
  );

  // Clearing the session is the point of logging out — navigating alone left
  // the JWT in localStorage, so the next visit walked straight back in.
  const handleLogout = () => {
    logout();
    navigate('/choose-portal', { replace: true });
  };

  return (
    <header className="top-header">
      <button className="icon-btn menu-btn" onClick={onMenuToggle} aria-label="Toggle menu">
        <IconMenu />
      </button>

      <PortalSearch
        portal={PORTALS.STUDENT}
        recordGroups={buildStudentResults}
        onNavigate={(m) => navigate(m.path)}
        placeholder={searchPlaceholder}
      />

      <div className="header-actions">
        {/* Chatbot */}
        {assistantAvailable && (
          <button className="aims-chat-btn" onClick={openChat} aria-label="AI assistant" title="AI Assistant">
            <IconSparkle />
          </button>
        )}

        {/* Notifications */}
        <NotificationBell
          items={items}
          unreadCount={unreadCount}
          onMarkAllRead={markAllRead}
          onItemClick={(n) => { markRead(n.id); if (n.link) navigate(n.link); }}
          onViewAll={() => navigate('/student/notifications')}
        />

        {/* Profile */}
        <ProfileDropdown
          name={profile.fullName}
          role="Student"
          department={profile.department}
          email={profile.email}
          avatarUrl={profile.photoUrl}
          avatarColor="#B91C2C"
          initials={profile.initials}
          onMyProfile={() => navigate('/student/profile')}
          // There is no separate student settings page; Settings opens the
          // profile editor, which is the only thing a student can change.
          onSettings={() => navigate('/student/profile?edit=1')}
          onLogout={handleLogout}
        />
      </div>
    </header>
  );
}
