import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadStudentData } from '../api/studentData';
import { student as studentKeys } from '../api/queryKeys';
import {
  students as studentsApi,
  users as usersApi,
  auth as authApi,
} from '../api/endpoints';
import { assetUrl } from '../api/client';
import { invalidateAvatar } from '../api/avatarCache';

/*
 * The signed-in student's profile.
 *
 * There is no placeholder profile here any more. The page used to start from a
 * hardcoded "Ahmed Hassan / CS2021-042 / CGPA 3.72" record, which meant every
 * student saw somebody else's details for the first second of every page load,
 * and any field the API did not return kept the invented value permanently.
 *
 * `profile` starts as EMPTY_PROFILE — the right shape with nothing filled in —
 * and `loading` tells the screens to render their loading state instead.
 */

const StudentProfileContext = createContext(null);

export const useStudentProfile = () => {
  const ctx = useContext(StudentProfileContext);
  if (!ctx) throw new Error('useStudentProfile must be used within StudentProfileProvider');
  return ctx;
};

/**
 * The shape every student screen reads, with nothing invented. Used only while
 * the real record is loading or after a failure, so a page that renders before
 * the fetch resolves gets empty fields rather than another student's data.
 */
export const EMPTY_PROFILE = {
  firstName: '',
  lastName: '',
  fullName: '',
  initials: '',
  rollNo: '',
  program: '—',
  department: '—',
  semester: '—',
  batch: '—',
  section: '—',
  email: '—',
  phone: '—',
  dob: '—',
  gender: '—',
  cnic: '—',
  status: '—',
  address: '—',
  nationality: '—',
  bloodGroup: '—',
  cgpa: null,
  gpa: null,
  cgpaOutOf: 4.0,
  attendancePct: null,
  enrolledCourses: null,
  guardian: '—',
  guardianContact: '—',
  guardianRelationship: '—',
  photoUrl: null,
};

export const StudentProfileProvider = ({ children }) => {
  const queryClient = useQueryClient();
  /*
   * Memoised.
   *
   * The key factories build a fresh array on every call, and react-query is
   * happy with that — it hashes the key rather than comparing identity. But
   * anything that puts the key in a DEPENDENCY ARRAY sees a new value on every
   * render, so the callback is rebuilt, the effect that depends on it re-runs,
   * and an effect that invalidates the key becomes a refetch loop.
   *
   * Measured before this was fixed: /api/faculty/badges and /api/notifications
   * each went out 10 times in a five-route walk — once per render pass — while
   * every other endpoint had settled to 1.
   */
  const key = useMemo(() => studentKeys.profile(), []);

  /*
   * The student's own record — profile, courses, attendance, results, fees —
   * loaded once and held in the shared cache.
   *
   * This provider wraps every student route, so it was re-mounted and
   * re-fetched on each full page load; `/api/students/me` went out 20 times in
   * a ten-page walk. It is now one keyed query, and the top bar, the profile
   * screen and every module read the same copy.
   */
  const query = useQuery({
    queryKey: key,
    queryFn: () => loadStudentData(),
  });

  const studentData = query.data ?? null;
  const loading = query.isPending;
  const error = query.error ? query.error.message : null;

  /*
   * `profile` stays local state, and deliberately so.
   *
   * It is an EDIT BUFFER, not server state: the profile form writes into it on
   * every keystroke through updateProfile(), and saveProfile() reconciles it
   * with what the server says it stored. Putting a half-typed field in the
   * shared cache would push it at every other screen reading this key.
   *
   * So the cached record seeds it, once per fetched document.
   */
  const [profile, setProfile] = useState(EMPTY_PROFILE);

  const seededFor = useRef(null);

  useEffect(() => {
    if (!query.data || seededFor.current === query.data) return;
    seededFor.current = query.data;
    setProfile({ ...EMPTY_PROFILE, ...query.data.profile });
  }, [query.data]);

  const load = useCallback(async () => {
    // Force a re-seed: this is an explicit "throw away what is on screen and
    // read the record again", which is what every caller uses it for.
    seededFor.current = null;
    await queryClient.invalidateQueries({ queryKey: key });
    return true;
  }, [queryClient, key]);

  /* ── Local field update, deriving the display name from first/last ── */
  const updateProfile = useCallback((updates) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      if (updates.firstName !== undefined || updates.lastName !== undefined) {
        const fn = next.firstName || '';
        const ln = next.lastName || '';
        next.fullName = [fn, ln].filter(Boolean).join(' ');
        next.initials = `${fn.charAt(0)}${ln.charAt(0)}`.toUpperCase();
      }
      return next;
    });
  }, []);

  /**
   * Persists the editable part of the profile.
   *
   * PUT /api/students/me is the student self-service route. It accepts email,
   * phone, dob, gender, address, nationality and blood_group — the details a
   * student is responsible for keeping current on their own record.
   *
   * Name, registration number, CNIC, programme, batch, section and semester
   * are what the record is verified against, so they stay on the Admin-only
   * route and are never sent from here even if the form carries them.
   *
   * Throws on failure so the caller shows the server's message instead of a
   * success toast for a save that did not happen.
   */
  const saveProfile = useCallback(async (updates) => {
    const payload = {};

    // A dash is this UI's "not on file" marker, not a value to store. An empty
    // string is meaningful though: it means the student cleared the field, and
    // the API maps it to NULL.
    const given = (v) => v !== undefined && v !== null && v !== '—';

    if (given(updates.email) && updates.email !== '') payload.email = updates.email;
    if (given(updates.phone)) payload.phone = updates.phone;
    if (given(updates.gender) && updates.gender !== '') payload.gender = updates.gender;
    if (given(updates.address)) payload.address = updates.address;
    if (given(updates.nationality)) payload.nationality = updates.nationality;
    if (given(updates.bloodGroup)) payload.blood_group = updates.bloodGroup;

    // students.dob is a DATE column; the API rejects anything but YYYY-MM-DD.
    if (given(updates.dob) && /^\d{4}-\d{2}-\d{2}$/.test(updates.dob)) {
      payload.dob = updates.dob;
    }

    if (Object.keys(payload).length === 0) {
      throw new Error('There is nothing to save. Change a detail first.');
    }

    const res = await studentsApi.updateMe(payload);
    const saved = res?.data || res || {};

    // Trust the server's copy of what it stored rather than the form values.
    const readBack = (serverValue, sentValue, current) => {
      if (serverValue !== undefined && serverValue !== null) return serverValue;
      if (sentValue !== undefined) return sentValue === '' ? '—' : sentValue;
      return current;
    };

    const applied = {
      email: readBack(saved.email, payload.email, profile.email),
      phone: readBack(saved.phone, payload.phone, profile.phone),
      dob: readBack(saved.dob, payload.dob, profile.dob),
      gender: readBack(saved.gender, payload.gender, profile.gender),
      address: readBack(saved.address, payload.address, profile.address),
      nationality: readBack(saved.nationality, payload.nationality, profile.nationality),
      bloodGroup: readBack(saved.blood_group, payload.blood_group, profile.bloodGroup),
    };

    updateProfile(applied);
    return applied;
  }, [updateProfile, profile]);

  /**
   * Uploads a new avatar to POST /api/users/me/profile-picture and stores the
   * path the server returns. Previously this only set a data: URL in React
   * state, so the new photo vanished on the next page load.
   */
  const uploadPhoto = useCallback(async (file) => {
    const res = await usersApi.uploadProfilePicture(file);

    /*
     * Drop the shared cache entry for this account.
     *
     * `photoUrl` below only updates THIS portal's own profile object. Every
     * other place the student's face appears — the top bar, and now their
     * parent's ward list and every admin and faculty roster — reads through
     * api/avatarCache, which would keep handing out the picture it already
     * holds. That is the "I changed it and it did not change" report.
     */
    if (profile?.userId) invalidateAvatar(profile.userId);
    const stored = res?.profile_picture || res?.data?.profile_picture || null;

    /*
     * The upload response returns the avatar's URL, not its bytes, and that
     * URL is now an authenticated API route — so it cannot go straight into an
     * <img src>. The freshly uploaded file is already in hand as a File
     * object, so it is turned into a blob: URL directly rather than being
     * downloaded back from the server it was just sent to.
     *
     * That also makes the new picture appear immediately: re-requesting the
     * avatar route would race the browser's own cache of the previous one.
     */
    const preview = file ? URL.createObjectURL(file) : assetUrl(stored);

    updateProfile({ photoUrl: preview });
    return stored;
  }, [updateProfile, profile]);

  /** Clears the avatar on the server as well as on screen. */
  const removePhoto = useCallback(async () => {
    await usersApi.deleteProfilePicture();
    if (profile?.userId) invalidateAvatar(profile.userId);
    updateProfile({ photoUrl: null });
  }, [updateProfile, profile]);

  /**
   * PUT /api/auth/change-password. The student portal had no way to reach this
   * at all, so changing a password meant using the forgot-password flow.
   */
  const changePassword = useCallback(
    (currentPassword, newPassword) => authApi.changePassword(currentPassword, newPassword),
    [],
  );

  const value = {
    profile,
    updateProfile,
    saveProfile,
    uploadPhoto,
    removePhoto,
    changePassword,
    studentData,
    loading,
    error,
    reload: load,
  };

  return (
    <StudentProfileContext.Provider value={value}>
      {children}
    </StudentProfileContext.Provider>
  );
};
