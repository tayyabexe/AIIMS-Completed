import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import AvatarUploader from '../../components/common/AvatarUploader';
import { useDraft, useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import { Link, useSearchParams } from 'react-router-dom';
import { useStudentProfile } from '../../context/StudentProfileContext';
import StudentTopBar from '../../components/student/StudentTopBar';
import './StudentDashboard.css';
import './Profile.css';
import { SkeletonRegion, SkeletonHero, SkeletonStatRow, SkeletonCardGrid } from '../../components/common/Skeleton';
import {
  IconGrid, IconBook, IconCalendarCheck, IconTrending, IconCard,
  IconClock, IconFile, IconUser, IconAward,
} from '../../components/student/icons';

/* ── Inline profile‑specific icons ── */
/* Two figures, for the Parent / Guardian section — the shared IconUser is one
   figure and already labels Personal Information. */
const IconUsersOutline = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="17" cy="9.2" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3.4 19c.85-3.1 3.1-4.9 5.6-4.9s4.75 1.8 5.6 4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M14.6 14.7c2 .2 3.7 1.8 4.3 4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M2.5 7l9.5 6 9.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M16.5 3.5l4 4L8 20H4v-4L16.5 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const IconGraduation = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M18 8.5V12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const IconBookOpen = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M4 5.5A2.5 2.5 0 016.5 3H12v18H6.5A2.5 2.5 0 014 18.5v-13z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M20 5.5A2.5 2.5 0 0017.5 3H12v18h5.5a2.5 2.5 0 002.5-2.5v-13z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const IconBadgeCheck = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 3l2 2 3-1.5L17.5 6l3 .5-1 3L22 12l-2.5 2.5 1 3-3 .5L17.5 21 15 19.5 12 22l-3-2.5L6.5 21l-.5-3-3-.5 1-3L2 12l2.5-2.5-1-3 3-.5L6.5 3 9 4.5 12 3z" stroke="currentColor" strokeWidth="0.8" opacity="0.2" />
  </svg>
);

const IconActivity = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M22 12h-4l-3 8-4-16-3 8H2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconCap2 = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

/* ══════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════ */

/* Blood groups, mirroring the ENUM on students.blood_group. */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* The API stores DOB as a DATE. A dash means "not on file" and must not be
   handed to a date input, which would reject it and render blank. */
const toDateInput = (value) =>
  (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? String(value).slice(0, 10) : '');

/* A dash is the display marker for an empty field; an input should show it as
   genuinely empty so the student is not editing the word "—". */
const toInput = (value) => (value === '—' || value == null ? '' : value);

const Profile = () => {
  const {
    profile: student, studentData, saveProfile, uploadPhoto, removePhoto,
    changePassword, loading, error,
  } = useStudentProfile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const [activeSection, setActiveSection] = useState(0);
  /*
   * The file input, the camera refs, the preview state and the upload flag
   * that used to live here are gone. All of it now belongs to
   * components/common/AvatarUploader, which owns the whole picker — including
   * stopping the webcam stream, which this component was doing in three
   * separate places and still leaked when the dialog was closed by the
   * backdrop.
   *
   * What is left is the one piece this page genuinely owns: whether the dialog
   * is open.
   */

  /* ── Interactive states ── */
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showToast, setShowToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editForm, setEditForm] = useState({
    email: '',
    phone: '',
    dob: '',
    gender: '',
    address: '',
    nationality: '',
    bloodGroup: '',
  });

  const online = useOnlineStatus();

  /*
   * The values this form was seeded with when it opened.
   *
   * The edit form is not blank — it is pre-filled from the student's saved
   * record, so "has anything been typed" cannot be answered by testing whether
   * the fields are empty. Without this baseline, merely opening the editor and
   * closing it again left a "draft" behind that was just a copy of what the
   * server already held, and the form permanently claimed unsaved work.
   */
  const seededForm = useRef(null);

  /*
   * The half-edited profile survives a crash, a refresh or a dropped
   * connection.
   *
   * `enabled` matters more than it looks: useDraft applies a stored draft when
   * a form becomes enabled, not when this component mounts. This component
   * mounts with the modal shut, and handleEditProfile below re-seeds editForm
   * from the server record every time the modal is opened — so a draft applied
   * at mount would be overwritten a moment later by that seeding, which is
   * exactly why previously typed values never reappeared in these fields.
   *
   * The password form further down is deliberately NOT drafted: writing a
   * password into localStorage leaves it in plaintext on disk, readable by any
   * script on this origin, long after the form has closed.
   */
  const profileDraft = useDraft('student.profile.edit', editForm, {
    enabled: showEditModal,
    onRestore: setEditForm,
    /*
     * Untouched means "identical to what it was opened with", not "blank".
     * Before the modal has ever been opened there is no baseline, and nothing
     * has been typed either, so that counts as empty.
     */
    isEmpty: (value) => {
      const seed = seededForm.current;
      if (!seed) return true;
      return Object.keys(seed).every((key) => (value?.[key] ?? '') === (seed[key] ?? ''));
    },
  });

  /* ── Password change ── */
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordError, setPasswordError] = useState(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  /* ── Derived data ──
     Every tile reads a real column. A value the database does not hold yet
     shows a dash rather than a zero, so "no result published" is not
     displayed as a CGPA of 0. */
  const statsData = useMemo(() => [
    {
      label: 'CGPA',
      value: student.cgpa != null ? student.cgpa.toFixed(2) : '—',
      suffix: student.cgpa != null ? `/ ${student.cgpaOutOf}` : '',
      color: '#7c3aed',
      icon: <IconAward />,
    },
    {
      label: 'Attendance',
      value: student.attendancePct != null ? `${student.attendancePct}%` : '—',
      suffix: '',
      color: '#16a34a',
      icon: <IconCalendarCheck />,
    },
    {
      label: 'Enrolled Courses',
      value: student.enrolledCourses != null ? student.enrolledCourses : '—',
      suffix: '',
      color: '#2563eb',
      icon: <IconBookOpen />,
    },
    {
      label: 'Semester GPA',
      value: student.gpa != null ? student.gpa.toFixed(2) : '—',
      suffix: student.gpa != null ? `/ ${student.cgpaOutOf}` : '',
      color: '#d97706',
      icon: <IconBadgeCheck />,
    },
  ], [student]);

  /*
   * The guardian rows, flattened into the label/value pairs the info card
   * renders. Each guardian contributes a name, an email, a phone and, where
   * one is recorded, an occupation.
   *
   * Labelled by relationship — "Father", "Mother", "Guardian" — because that
   * is what the student recognises; the ordinal fallback only appears if the
   * link row somehow has no relationship on it. An empty list renders one
   * honest line rather than a column of dashes.
   */
  const guardianFields = useMemo(() => {
    const rows = Array.isArray(student.guardians) ? student.guardians : [];

    if (!rows.length) {
      return [{
        label: 'Parent / Guardian',
        value: 'No parent or guardian is linked to your record.',
      }];
    }

    return rows.flatMap((g, i) => {
      const who = g.relationship || (rows.length > 1 ? `Guardian ${i + 1}` : 'Guardian');
      const fields = [
        { label: `${who} — Name`, value: g.name || '—' },
        { label: `${who} — Email`, value: g.email || '—' },
        { label: `${who} — Phone`, value: g.phone || '—' },
      ];
      if (g.occupation) fields.push({ label: `${who} — Occupation`, value: g.occupation });
      return fields;
    });
  }, [student.guardians]);

  const infoSections = useMemo(() => [
    {
      title: 'Personal Information',
      icon: <IconUser />,
      fields: [
        { label: 'Full Name', value: student.fullName || '—' },
        { label: 'Date of Birth', value: student.dob },
        { label: 'Gender', value: student.gender },
        { label: 'Blood Group', value: student.bloodGroup },
        { label: 'Nationality', value: student.nationality },
        { label: 'CNIC / B-Form', value: student.cnic },
      ],
    },
    {
      title: 'Academic Information',
      icon: <IconGraduation />,
      fields: [
        { label: 'Roll Number', value: student.rollNo || '—' },
        { label: 'Program', value: student.program },
        { label: 'Section', value: student.section },
        { label: 'Current Semester', value: student.semester },
        { label: 'Batch', value: student.batch },
        { label: 'Academic Status', value: student.status },
      ],
    },
    {
      title: 'Contact Details',
      icon: <IconMail />,
      fields: [
        { label: 'Email Address', value: student.email },
        { label: 'Phone Number', value: student.phone },
        { label: 'Address', value: student.address },
      ],
    },
    /*
     * Parent / Guardian.
     *
     * This used to be three fields at the bottom of Contact Details, built
     * from `guardians[0]` — so a student with both a father and a mother
     * linked saw one of them and had no way to tell the other existed. And no
     * email at all: `parents` has no email column, so the endpoint never
     * carried one until it was joined from the parent's login account.
     *
     * One block per linked guardian, labelled by relationship, read-only. A
     * student does not edit their own parent record.
     */
    {
      title: 'Parent / Guardian',
      icon: <IconUsersOutline />,
      fields: guardianFields,
    },
  ], [student, guardianFields]);

  /* Where this CGPA sits on the 4.0 scale. Banded from the student's own
     figure rather than the fixed praise the card used to show everyone. */
  const cgpaStanding = useMemo(() => {
    const cgpa = student.cgpa;
    if (cgpa == null) {
      return { label: 'No result published yet', detail: 'Your CGPA appears once a semester result is published.' };
    }
    if (cgpa >= 3.7) return { label: 'Outstanding', detail: 'Distinction range on the 4.0 scale' };
    if (cgpa >= 3.0) return { label: 'Good standing', detail: 'Comfortably above the 2.0 requirement' };
    if (cgpa >= 2.0) return { label: 'Satisfactory', detail: 'Above the 2.0 minimum requirement' };
    return { label: 'Below requirement', detail: 'Under the 2.0 minimum — speak to your advisor' };
  }, [student.cgpa]);

  /* Present/absent/total from the student's own attendance rows. */
  const attendanceSummary = useMemo(() => {
    const att = studentData?.attendance;
    if (!att || !att.total) return null;
    return [
      { label: 'Classes attended', value: att.present },
      { label: 'Classes missed', value: att.absent },
      { label: 'Total sessions', value: att.total },
    ];
  }, [studentData]);

  /* ── Handlers ── */
  const handleEditProfile = useCallback(() => {
    setEditError(null);

    const seed = {
      email: toInput(student.email),
      phone: toInput(student.phone),
      dob: toDateInput(student.dob),
      gender: toInput(student.gender),
      address: toInput(student.address),
      nationality: toInput(student.nationality),
      bloodGroup: toInput(student.bloodGroup),
    };

    /*
     * The baseline is recorded BEFORE the modal opens, so it is in place by the
     * time useDraft's restore effect runs on the next render. A stored draft
     * then lands on top of these values rather than the other way round, which
     * is the whole fix: what the student typed wins over what the server holds,
     * because the typing is the newer of the two.
     */
    seededForm.current = seed;
    setEditForm(seed);
    setShowEditModal(true);
  }, [student]);

  // "Settings" in the profile dropdown lands here with ?edit=1, which opens the
  // editor directly. The param is stripped so a refresh does not reopen it.
  useEffect(() => {
    if (searchParams.get('edit') !== '1') return;
    handleEditProfile();
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, handleEditProfile]);

  const handleSaveProfile = useCallback(async () => {
    setIsSaving(true);
    setEditError(null);
    try {
      await saveProfile(editForm);
      profileDraft.clear();
      setShowEditModal(false);
      showToastMessage('Profile updated successfully.');
    } catch (err) {
      // Keep the modal open so the entered values are not lost, and show the
      // server's own message — "That email address is already in use" is far
      // more useful than a generic failure.
      setEditError(err.message || 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  }, [editForm, saveProfile]);

  /* Cancel: discard the edits and close. The form is rebuilt from the stored
     profile next time it opens, so nothing typed here leaks into the next
     session of the modal. */
  const handleCancelEdit = useCallback(() => {
    setShowEditModal(false);
    setEditError(null);
  }, []);

  /* ── Change password ── */
  const handleChangePassword = useCallback(async () => {
    const { currentPassword, newPassword, confirmPassword } = passwordForm;

    if (!currentPassword || !newPassword) {
      setPasswordError('Enter your current password and a new one.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Your new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('Your new password must be different from the current one.');
      return;
    }

    setIsChangingPassword(true);
    setPasswordError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setShowPasswordModal(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showToastMessage('Password changed successfully.');
    } catch (err) {
      // A wrong current password comes back as 400/401 from the API.
      setPasswordError(err.message || 'Could not change your password.');
    } finally {
      setIsChangingPassword(false);
    }
  }, [passwordForm, changePassword]);

  const handleClosePasswordModal = useCallback(() => {
    setShowPasswordModal(false);
    setPasswordError(null);
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
  }, []);

  const handleShare = useCallback(() => {
    const profileUrl = window.location.href;
    navigator.clipboard.writeText(profileUrl).then(() => {
      showToastMessage('Profile link copied to clipboard!');
    }).catch(() => {
      showToastMessage('Profile link copied to clipboard!');
    });
  }, []);

  /* ── Photo management ──
     The API accepts JPEG/PNG/WEBP/GIF up to 1MB (upload.middleware). Both
     limits are enforced in AvatarUploader, which is the only picker on this
     page, so an oversized file is refused before it is decoded rather than
     after it is uploaded. */
  /*
   * handleFileSelect / handleConfirmPhoto / handleOpenCamera /
   * handleCapturePhoto / handleStopCamera / handleRemovePhoto /
   * handleClosePhotoModal were all here.
   *
   * Every one of them is now inside AvatarUploader, which is mounted below and
   * given `uploadPhoto` and `removePhoto` from StudentProfileContext directly.
   * The endpoints they call are unchanged — POST and DELETE on
   * /api/users/me/profile-picture — so the behaviour is the same and the code
   * is in one place instead of four portals' worth of copies.
   */

  /* The camera-stream cleanup that was here is now AvatarUploader's, which
     stops the tracks on close AND on unmount — this copy only ran on unmount,
     so closing the dialog left the webcam light on. */

  /* The "Skills & Expertise" and "Achievements" cards that used to sit here
     were removed. Neither had a column in aims_db: the lists were hardcoded,
     and their editors called a `setStudent` setter that does not exist in this
     component — the profile comes from context — so adding or removing a skill
     threw a ReferenceError and broke the page. */

  const showToastMessage = useCallback((message) => {
    setShowToast(message);
    setTimeout(() => setShowToast(null), 3000);
  }, []);

  /* ── Close modals on Escape ── */
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleCancelEdit();
        handleClosePasswordModal();
        // The picture dialog handles its own Escape.
      }
    };
    if (showEditModal || showPhotoModal || showPasswordModal) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [showEditModal, showPhotoModal, showPasswordModal,
      handleCancelEdit, handleClosePasswordModal]);

  const navItems = [
    { to: '/student/dashboard', icon: <IconGrid />, label: 'Dashboard' },
    { to: '/student/my-courses', icon: <IconBook />, label: 'My Courses' },
    { to: '/student/attendance', icon: <IconCalendarCheck />, label: 'Attendance' },
    { to: '/student/result', icon: <IconTrending />, label: 'Results' },
    { to: '/student/fee-management', icon: <IconCard />, label: 'Fee Management' },
    { to: '/student/time-table', icon: <IconClock />, label: 'Timetable' },
    { to: '/student/document', icon: <IconFile />, label: 'Documents' },
    { to: '/student/profile', icon: <IconUser />, label: 'Profile', active: true },
  ];

  return (
    <div className="dashboard-layout">
      {/* Mobile sidebar backdrop */}
      <div
        className={`sidebar-backdrop ${isMenuOpen ? 'visible' : ''}`}
        onClick={() => setIsMenuOpen(false)}
      ></div>

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${isMenuOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-brand" onClick={() => window.history.back()}>
          <span className="brand-icon"><IconCap2 /></span>
          {isMenuOpen && (
            <div className="brand-text">
              <span className="brand-name">AIMS</span>
              <span className="brand-sub">Student Portal</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {isMenuOpen && <span className="nav-text">{item.label}</span>}
              {item.active && isMenuOpen && <span className="nav-chevron">›</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isMenuOpen ? (
            <>
              <p className="footer-line">CORVIT Systems © 2024</p>
              <p className="footer-line">AIMS v2.1.0</p>
            </>
          ) : (
            <p className="footer-line">©</p>
          )}
        </div>
      </aside>

      {/* ── Main wrapper ── */}
      <div className="main-wrapper">
        {/* ── Top header (shared: chatbot, notifications, profile) ── */}
        <StudentTopBar onMenuToggle={toggleMenu} />

        {/* ── Breadcrumb ── */}
        <div className="breadcrumb-bar">
          <span>AIMS</span>
          <span className="crumb-sep">/</span>
          <span>Student Portal</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">Profile</span>
        </div>

        {/* ── Page content ── */}
        <div className="profile-page">

          {/* The record is fetched after sign-in, so the page says so instead
              of briefly rendering an empty profile as though it were real. */}
          {/* A spinner and the words "Loading your profile…" used to sit ABOVE
              a fully drawn page whose every field read as an em dash — so the
              page looked like a real, empty profile with a spinner stuck on
              top. The skeleton replaces the page instead of annotating it. */}
          {loading && (
            <SkeletonRegion label="Loading your profile">
              <SkeletonHero chips={3} style={{ marginBottom: '1.25rem' }} />
              <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
              <SkeletonCardGrid count={4} minWidth={300} lines={4} />
            </SkeletonRegion>
          )}

          {!loading && error && (
            <div className="profile-page-state profile-page-error" role="alert">
              <span>Could not load your profile: {error}</span>
            </div>
          )}

          {/*
            Everything below is gated on the record having arrived.

            It was not, and that was the second half of the problem on this
            page: the hero, the four stat tiles and every information card
            rendered from an empty `student` object while the fetch was in
            flight, printing an em dash in each field. The result was a
            complete, believable, blank profile with a spinner sitting on top
            of it. A skeleton is only honest if the thing it stands in for is
            not also on screen.
          */}
          {!loading && (
          <>
          {/* ── Profile Hero Header ── */}
          <div className="profile-hero">
            <div className="profile-hero-bg">
              <div className="hero-blob hero-blob-1"></div>
              <div className="hero-blob hero-blob-2"></div>
            </div>
            <div className="profile-hero-content">
              <div className="profile-avatar-large">
                {student.photoUrl ? (
                  <img src={student.photoUrl} alt="Profile" className="avatar-photo" />
                ) : (
                  <span className="avatar-initials">{student.initials}</span>
                )}
                <button className="avatar-edit-btn" aria-label="Change photo" onClick={() => setShowPhotoModal(true)}>
                  <IconEdit />
                </button>
              </div>
              <div className="profile-hero-info">
                <h1 className="profile-name-large">{student.fullName}</h1>
                <div className="profile-tags-row">
                  <span className="profile-tag">{student.rollNo}</span>
                  <span className="profile-tag">{student.semester}</span>
                  <span className="profile-tag">{student.batch}</span>
                </div>
                <p className="profile-program">{student.program}</p>
                <p className="profile-dept">{student.department}</p>
              </div>
              <div className="profile-hero-actions">
                <button className="profile-edit-btn" onClick={handleEditProfile}>
                  <IconEdit />
                  <span>Edit Profile</span>
                </button>
                <button className="profile-share-btn" onClick={handleShare} title="Copy profile link">
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
                    <circle cx="6.5" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="17.5" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                    <circle cx="17.5" cy="17" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M9.5 10.5l5-3M9.5 13.5l5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* ── Stats Row ── */}
          <div className="profile-stats-row">
            {statsData.map((stat, i) => (
              <div className="profile-stat-card" key={i}>
                <span className="profile-stat-icon" style={{ background: `${stat.color}15`, color: stat.color }}>
                  {stat.icon}
                </span>
                <div className="profile-stat-body">
                  <span className="profile-stat-value">
                    {stat.value}
                    {stat.suffix && <span className="profile-stat-suffix">{stat.suffix}</span>}
                  </span>
                  <span className="profile-stat-label">{stat.label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Main two-column layout ── */}
          <div className="profile-two-col">

            {/* ── Left column: Info sections ── */}
            <div className="profile-left">
              {/* Section tabs */}
              <div className="profile-section-tabs">
                {infoSections.map((sec, i) => (
                  <button
                    key={i}
                    className={`profile-tab ${activeSection === i ? 'active' : ''}`}
                    onClick={() => setActiveSection(i)}
                  >
                    <span className="tab-icon">{sec.icon}</span>
                    <span className="tab-label">{sec.title}</span>
                  </button>
                ))}
              </div>

              {/* Active section content */}
              <div className="profile-info-card">
                <div className="info-card-header">
                  <span className="info-card-icon">{infoSections[activeSection].icon}</span>
                  <span className="info-card-title">{infoSections[activeSection].title}</span>
                </div>
                <div className="info-card-body">
                  {infoSections[activeSection].fields.map((field, i) => (
                    <div className="info-field" key={i}>
                      <span className="info-field-label">{field.label}</span>
                      <span className="info-field-value">{field.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Account security */}
              <div className="profile-skills-card">
                <div className="skills-header">
                  <IconActivity />
                  <span className="skills-title">Account &amp; Security</span>
                </div>
                <div className="profile-security-row">
                  <div className="profile-security-text">
                    <span className="profile-security-title">Password</span>
                    <span className="profile-security-desc">
                      Change the password you use to sign in to AIMS.
                    </span>
                  </div>
                  <button
                    className="profile-security-btn"
                    onClick={() => setShowPasswordModal(true)}
                  >
                    Change Password
                  </button>
                </div>
              </div>
            </div>

            {/* ── Right column ── */}
            <div className="profile-right">

              {/* CGPA Ring Card. The ring is drawn from the published result;
                  with no result yet it renders empty rather than as a zero. */}
              <div className="profile-ring-card">
                <span className="ring-card-title">Overall CGPA</span>
                <div className="ring-card-visual">
                  <svg viewBox="0 0 120 120" className="ring-svg">
                    <circle cx="60" cy="60" r="50" stroke="#eceef2" strokeWidth="8" fill="none" />
                    <circle
                      cx="60" cy="60" r="50"
                      stroke="#7c3aed" strokeWidth="8" fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${((student.cgpa || 0) / student.cgpaOutOf) * 314.16} 314.16`}
                      transform="rotate(-90 60 60)"
                    />
                  </svg>
                  <div className="ring-card-center">
                    <span className="ring-card-value">
                      {student.cgpa != null ? student.cgpa.toFixed(2) : '—'}
                    </span>
                    <span className="ring-card-outof">/ {student.cgpaOutOf}</span>
                  </div>
                </div>
                <div className="ring-card-footer">
                  {/* Banded off the student's own CGPA. The previous
                      "Outstanding Performance / Top 5% of class" was fixed text
                      shown to every student regardless of their result. */}
                  <span className="ring-card-label">{cgpaStanding.label}</span>
                  <span className="ring-card-sub">{cgpaStanding.detail}</span>
                </div>
              </div>

              {/* Attendance, from the student's own attendance records */}
              <div className="profile-achievements-card">
                <div className="achv-header">
                  <IconCalendarCheck />
                  <span className="achv-title">Attendance</span>
                  {student.attendancePct != null && (
                    <span className="achv-count">{student.attendancePct}%</span>
                  )}
                </div>
                <div className="achv-list">
                  {attendanceSummary ? (
                    attendanceSummary.map((row) => (
                      <div className="achv-item" key={row.label}>
                        <span className="achv-dot"></span>
                        <span className="achv-text">{row.label}: <strong>{row.value}</strong></span>
                      </div>
                    ))
                  ) : (
                    <div className="achv-item">
                      <span className="achv-text">No attendance has been recorded yet.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* The "ID card preview" that used to sit here has been removed.
                  It was a decorative dark card that only restated the name,
                  registration number, programme, semester, batch and blood
                  group already shown above it, and it is not an ID this system
                  issues. */}

            </div>
          </div>
          </>
          )}

        </div>
      </div>

      {/* ═══ Edit Profile Modal ═══ */}
      {showEditModal && (
        <div className="profile-modal-overlay" onClick={handleCancelEdit}>
          <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-header">
              <h3 className="profile-modal-title">
                <IconEdit />
                Edit Profile
              </h3>
              <button className="profile-modal-close" onClick={handleCancelEdit}>✕</button>
            </div>
            <div className="profile-modal-body">
              {/* Discarding has to put the saved record back in the fields.
                  Without onDiscard the draft is deleted from disk but its
                  values stay on screen, so "Discard draft" appears to do
                  nothing and the next keystroke writes them straight back. */}
              <DraftNotice
                draft={profileDraft}
                online={online}
                onDiscard={() => setEditForm(seededForm.current || editForm)}
              />
              {/* Name, roll number, programme, batch and section are not here
                  on purpose: they are what the record is verified against and
                  only the registrar can change them. The form used to accept
                  edits to the name and then silently drop them. */}
              <p className="edit-form-note">
                Your name, roll number, programme and batch are maintained by the
                registrar. Contact the admin office if any of them is wrong.
              </p>

              {editError && (
                <div className="edit-form-error" role="alert">{editError}</div>
              )}

              <div className="edit-form-group">
                <label className="edit-form-label" htmlFor="profile-email">Email Address</label>
                <input
                  id="profile-email"
                  type="email"
                  className="edit-form-input"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              <div className="edit-form-group">
                <label className="edit-form-label" htmlFor="profile-phone">Phone Number</label>
                <input
                  id="profile-phone"
                  type="tel"
                  className="edit-form-input"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>
              <div className="edit-form-row">
                <div className="edit-form-group">
                  <label className="edit-form-label" htmlFor="profile-dob">Date of Birth</label>
                  {/* A date input, so what is sent always matches the
                      YYYY-MM-DD the DATE column requires. */}
                  <input
                    id="profile-dob"
                    type="date"
                    className="edit-form-input"
                    value={editForm.dob}
                    onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })}
                  />
                </div>
                <div className="edit-form-group">
                  <label className="edit-form-label" htmlFor="profile-gender">Gender</label>
                  <select
                    id="profile-gender"
                    className="edit-form-select"
                    value={editForm.gender}
                    onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}
                  >
                    <option value="">Not specified</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div className="edit-form-group">
                <label className="edit-form-label" htmlFor="profile-address">Address</label>
                <textarea
                  id="profile-address"
                  className="edit-form-textarea"
                  rows="2"
                  maxLength={255}
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                ></textarea>
              </div>
              <div className="edit-form-row">
                <div className="edit-form-group">
                  <label className="edit-form-label" htmlFor="profile-blood">Blood Group</label>
                  <select
                    id="profile-blood"
                    className="edit-form-select"
                    value={editForm.bloodGroup}
                    onChange={(e) => setEditForm({ ...editForm, bloodGroup: e.target.value })}
                  >
                    {/* An explicit empty option so a student who has not
                        recorded a blood group is not forced to invent one. */}
                    <option value="">Not specified</option>
                    {BLOOD_GROUPS.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </div>
                <div className="edit-form-group">
                  <label className="edit-form-label" htmlFor="profile-nationality">Nationality</label>
                  <input
                    id="profile-nationality"
                    type="text"
                    className="edit-form-input"
                    maxLength={50}
                    value={editForm.nationality}
                    onChange={(e) => setEditForm({ ...editForm, nationality: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="profile-modal-footer">
              <button className="profile-modal-cancel" onClick={handleCancelEdit} disabled={isSaving}>Cancel</button>
              <button className="profile-modal-save" onClick={handleSaveProfile} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <span className="save-spinner"></span>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" style={{ width: 15, height: 15 }}>
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        The profile-picture picker.
        ---------------------------
        What used to be here was ~150 lines of markup implementing a three-row
        menu — "Upload from Device", "Open Camera", "Remove Photo" — with the
        current photo shown at 60px above it and no way to drag a file onto
        anything. It is replaced by the shared dialog, which makes the picture
        itself the drop target and the preview.

        The handlers below are the same ones that were already here, so the
        upload still goes through StudentProfileContext -> POST
        /api/users/me/profile-picture and the removal through DELETE on the same
        path. Only the interface changed.
      */}
      <AvatarUploader
        open={showPhotoModal}
        onClose={() => setShowPhotoModal(false)}
        currentUrl={student.photoUrl}
        name={student.fullName}
        onUpload={async (file) => {
          await uploadPhoto(file);
          showToastMessage('Profile photo updated.');
        }}
        onRemove={async () => {
          await removePhoto();
          showToastMessage('Profile photo removed.');
        }}
      />

      {/* ═══ Change Password Modal ═══
          Posts to PUT /api/auth/change-password, which verifies the current
          password server-side before writing the new hash. The student portal
          previously had no way to reach this endpoint at all. */}
      {showPasswordModal && (
        <div className="profile-modal-overlay" onClick={handleClosePasswordModal}>
          <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-header">
              <h3 className="profile-modal-title">
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
                  <rect x="4" y="10.5" width="16" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 10.5V7a4 4 0 118 0v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                Change Password
              </h3>
              <button className="profile-modal-close" onClick={handleClosePasswordModal}>✕</button>
            </div>
            <div className="profile-modal-body">
              {passwordError && (
                <div className="edit-form-error" role="alert">{passwordError}</div>
              )}

              <div className="edit-form-group">
                <label className="edit-form-label" htmlFor="current-password">Current Password</label>
                <input
                  id="current-password"
                  type="password"
                  className="edit-form-input"
                  autoComplete="current-password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                />
              </div>
              <div className="edit-form-group">
                <label className="edit-form-label" htmlFor="new-password">New Password</label>
                <input
                  id="new-password"
                  type="password"
                  className="edit-form-input"
                  autoComplete="new-password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                />
                <span className="edit-form-hint">At least 8 characters.</span>
              </div>
              <div className="edit-form-group">
                <label className="edit-form-label" htmlFor="confirm-password">Confirm New Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  className="edit-form-input"
                  autoComplete="new-password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword(); }}
                />
              </div>
            </div>
            <div className="profile-modal-footer">
              <button
                className="profile-modal-cancel"
                onClick={handleClosePasswordModal}
                disabled={isChangingPassword}
              >
                Cancel
              </button>
              <button
                className="profile-modal-save"
                onClick={handleChangePassword}
                disabled={isChangingPassword}
              >
                {isChangingPassword ? (
                  <>
                    <span className="save-spinner"></span>
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Toast ═══ */}
      {showToast && (
        <div className="profile-toast">
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{showToast}</span>
        </div>
      )}
    </div>
  );
};

export default Profile;
