import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServerQuery } from '../../hooks/useAdminPage';
import { motion } from 'framer-motion';
import {
  Palette, Bell, Shield, Info, Check, Sun, Moon, Monitor, Loader2,
  User, KeyRound, Image as ImageIcon, Trash2, AlertTriangle, BellOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { usePreferences } from '../../context/PreferencesContext';
import { users as usersApi, auth as authApi } from '../../api/endpoints';
import RouteLoader from '../../components/common/RouteLoader';
import ApiErrorNotice from '../../components/common/ApiErrorNotice';
import useAuthedImage from '../../hooks/useAuthedImage';
import { invalidateAvatar } from '../../api/avatarCache';
import AvatarUploader from '../../components/common/AvatarUploader';
import DraftNotice from '../../components/common/DraftNotice';
import useDraft, { useOnlineStatus } from '../../hooks/useDraft';

/*
 * Admin Settings.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * Every value on this screen used to be written to localStorage, and NOTHING in
 * the codebase ever read any of it back. So each control did exactly one thing:
 * remember its own position, on one browser, forever, while changing nothing.
 *
 * Worse, several of them could not have worked even in principle. There is no
 * i18n layer, so "Language: Urdu" had nothing to translate. No date is
 * formatted through a setting, so "Date format: DD/MM/YYYY" reached no
 * formatter. There is no mail transport and no SMS gateway, so "Email
 * notifications" and "SMS notifications" had nothing to send with. "Institute
 * name" was read by no header. And the System panel printed an invented
 * version string, an invented environment and an invented "Last Backup".
 *
 * This screen now contains only settings that are stored on the SERVER against
 * the account (GET/PUT /api/users/me/preferences) and are honoured somewhere
 * real:
 *
 *   Theme        applied by ThemeContext on every portal
 *   Density      data-density on <html>; index.css scales row padding off it
 *   Font size    data-font-size on <html>; index.css scales the root type size
 *   Unread badge read by the Sidebar and Header bubbles
 *   Muted types  enforced by the API — notificationController drops these
 *                categories from the feed before it is sent
 *
 * Plus the account panel, which does real writes: change password, update
 * contact details, upload or remove a profile picture.
 *
 * A setting that cannot be honoured is worse than a missing one: it tells the
 * administrator the system is doing something it is not.
 */

const CATEGORIES = [
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme, density and text size' },
  { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Which alerts reach you' },
  { id: 'account', label: 'Account', icon: Shield, description: 'Profile, password and picture' },
  { id: 'about', label: 'About', icon: Info, description: 'This account and session' },
];

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Always light' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Always dark' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Follow the OS' },
];

const DENSITIES = [
  { value: 'compact', label: 'Compact', hint: 'Tighter rows — more on screen at once' },
  { value: 'comfortable', label: 'Comfortable', hint: 'The default spacing' },
  { value: 'spacious', label: 'Spacious', hint: 'Looser rows — easier to track across' },
];

const FONT_SIZES = [
  { value: 'small', label: 'Small', hint: '92% — more content per screen' },
  { value: 'medium', label: 'Medium', hint: 'The default' },
  { value: 'large', label: 'Large', hint: '108% — easier to read' },
];

/*
 * The notification categories this institute's data actually contains, with
 * what each one is about. `notifications.type` is a free-text column and these
 * twelve are the values present in it — muting one is enforced by the API, not
 * by hiding rows in the browser.
 */
const NOTIFICATION_TYPES = [
  { type: 'Result', description: 'Results published and grade changes' },
  { type: 'Registration', description: 'Course registration and enrolment' },
  { type: 'Library', description: 'Library notices' },
  { type: 'Attendance', description: 'Attendance warnings and registers' },
  { type: 'Document', description: 'Document uploads and verification' },
  { type: 'Fee', description: 'Vouchers, payments and dues' },
  { type: 'Scholarship', description: 'Scholarship awards and applications' },
  { type: 'Academic', description: 'Academic calendar and structure' },
  { type: 'HR', description: 'Staff and employment matters' },
  { type: 'Payroll', description: 'Salary and payroll' },
  { type: 'Leave', description: 'Leave applications and approvals' },
  { type: 'Meeting', description: 'Meeting invitations' },
];

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { preferences, loading: prefsLoading, save } = usePreferences();

  const [activeCategory, setActiveCategory] = useState(() => {
    // The Header deep-links here with a category already chosen.
    const requested = localStorage.getItem('aiims-settings-category');
    if (requested) localStorage.removeItem('aiims-settings-category');
    return CATEGORIES.some((c) => c.id === requested) ? requested : 'appearance';
  });

  const [savedField, setSavedField] = useState(null);
  const [pageError, setPageError] = useState(null);

  const flash = useCallback((field) => {
    setSavedField(field);
    setTimeout(() => setSavedField((f) => (f === field ? null : f)), 2000);
  }, []);

  /* Every write goes to the server and is confirmed only if it succeeded —
     PreferencesContext rolls the local value back on failure, so a switch can
     never end up showing a setting the account does not have. */
  const savePreference = useCallback(async (patch, field) => {
    const ok = await save(patch);
    if (ok) flash(field);
    else setPageError(new Error('Could not save that setting. It has been reverted.'));
    return ok;
  }, [save, flash]);

  const appearance = preferences.appearance || {};
  const notifications = preferences.notifications || {};
  const mutedTypes = notifications.mutedTypes || [];

  const toggleMuted = (type) => {
    const next = mutedTypes.includes(type)
      ? mutedTypes.filter((t) => t !== type)
      : [...mutedTypes, type];
    savePreference({ notifications: { mutedTypes: next } }, `mute:${type}`);
  };

  if (prefsLoading) {
    return <RouteLoader label="Loading settings…" hint="Your saved preferences" />;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div style={{ marginBottom: '1.75rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-dark)', letterSpacing: '-0.02em', margin: 0 }}>
          Settings
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
          Saved to your account, so they follow you to any machine you sign in on
        </p>
      </div>

      <ApiErrorNotice error={pageError} onDismiss={() => setPageError(null)} />

      <div className="settings-layout" style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

        {/* Categories */}
        <div style={{
          width: '230px', flexShrink: 0, backgroundColor: 'var(--surface, #FFFFFF)',
          borderRadius: '14px', border: '1px solid var(--border-light)',
          boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
          position: 'sticky', top: '1.5rem',
        }}>
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.7rem',
                  padding: '0.85rem 1rem', border: 'none', cursor: 'pointer',
                  textAlign: 'left', borderLeft: `3px solid ${active ? 'var(--red-accent, #991b1b)' : 'transparent'}`,
                  backgroundColor: active ? 'var(--red-accent-light, #FEF2F2)' : 'transparent',
                  transition: 'background-color 0.15s, border-color 0.15s',
                }}
              >
                <Icon size={17} style={{ color: active ? 'var(--red-accent, #991b1b)' : 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                    {cat.label}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {cat.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeCategory === 'appearance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <Card
                icon={<Palette size={18} style={{ color: '#7C3AED' }} />}
                iconBg="#F3E8FF"
                title="Theme"
                description="Applied across every portal, immediately"
                saved={savedField === 'theme'}
              >
                <ChoiceRow
                  options={THEMES}
                  value={appearance.theme || theme}
                  onChange={(value) => {
                    setTheme(value);              // instant, before the round-trip
                    savePreference({ appearance: { theme: value } }, 'theme');
                  }}
                />
              </Card>

              <Card
                icon={<Monitor size={18} style={{ color: '#2563EB' }} />}
                iconBg="#EFF6FF"
                title="Row density"
                description="How much vertical space tables and lists use"
                saved={savedField === 'density'}
              >
                <ChoiceRow
                  options={DENSITIES}
                  value={appearance.density || 'comfortable'}
                  onChange={(value) => savePreference({ appearance: { density: value } }, 'density')}
                />
              </Card>

              <Card
                icon={<span style={{ fontWeight: 900, fontSize: '15px', color: '#059669' }}>Aa</span>}
                iconBg="#ECFDF5"
                title="Text size"
                description="Scales the whole interface from the root, so nothing is left behind"
                saved={savedField === 'fontSize'}
              >
                <ChoiceRow
                  options={FONT_SIZES}
                  value={appearance.fontSize || 'medium'}
                  onChange={(value) => savePreference({ appearance: { fontSize: value } }, 'fontSize')}
                />
              </Card>
            </div>
          )}

          {activeCategory === 'notifications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <Card
                icon={<Bell size={18} style={{ color: '#D97706' }} />}
                iconBg="#FEF3C7"
                title="Unread badge"
                description="The count on the bell and in the sidebar"
                saved={savedField === 'unreadBadge'}
              >
                <Toggle
                  label="Show a badge when I have unread notifications"
                  hint="Turning this off hides the count. The notifications themselves still arrive."
                  checked={notifications.unreadBadge !== false}
                  onChange={(next) => savePreference({ notifications: { unreadBadge: next } }, 'unreadBadge')}
                />
              </Card>

              <Card
                icon={<BellOff size={18} style={{ color: '#DC2626' }} />}
                iconBg="#FEE2E2"
                title="Categories"
                description="Muting a category is enforced by the server — those notifications are not sent to you at all, rather than hidden after arrival"
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.5rem' }}>
                  {NOTIFICATION_TYPES.map(({ type, description }) => {
                    const on = !mutedTypes.includes(type);
                    return (
                      <label
                        key={type}
                        className="person-subrow"
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                          padding: '0.6rem 0.75rem', borderRadius: '10px',
                          border: '1px solid var(--border-light)', cursor: 'pointer',
                          backgroundColor: on ? 'transparent' : 'var(--navy-50, #F8FAFC)',
                          opacity: on ? 1 : 0.65,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleMuted(type)}
                          style={{ marginTop: '2px', accentColor: '#991b1b', cursor: 'pointer' }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                            {type}
                            {savedField === `mute:${type}` && <Check size={13} style={{ color: '#059669' }} />}
                          </span>
                          <span style={{ display: 'block', fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                            {description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {mutedTypes.length > 0 && (
                  <p style={{ fontSize: '0.78rem', color: '#92400E', margin: '0.85rem 0 0', fontWeight: 600 }}>
                    {mutedTypes.length} categor{mutedTypes.length === 1 ? 'y is' : 'ies are'} muted — you will not
                    receive those notifications.
                  </p>
                )}
              </Card>
            </div>
          )}

          {activeCategory === 'account' && <AccountPanel user={user} onError={setPageError} />}

          {activeCategory === 'about' && <AboutPanel user={user} />}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Account ─────────────────────────────────────────────────────────────
   Real writes only. The panel this replaces showed a hardcoded "Last Password
   Change: March 15, 2026", an "Update" button with no handler, and a
   "Two-Factor Authentication / Configure" pair for a feature this system does
   not have. */
function AccountPanel({ user, onError }) {
  const [account, setAccount] = useState(null);

  /*
   * The signed-in account, from the shared cache — the same 'account-me' key
   * the faculty Settings screen reads, so the two never fetch it twice.
   *
   * Declared HERE, at the top of the panel, and not beside the effect that
   * consumes it: `loading` is read further down by the draft hook
   * (`enabled: !loading`), and a `const` cannot be used above its declaration.
   * Putting the query where the old loader sat threw "Cannot access 'loading'
   * before initialization" and took the whole panel down — caught on screen.
   */
  const accountQuery = useServerQuery(
    // No heartbeat: this query seeds the contact fields below, and an
    // answer landing while an email is half typed would overwrite it.
    () => usersApi.me(), {}, { key: 'account-me', live: false },
  );

  const loading = accountQuery.loading;

  const [contact, setContact] = useState({ email: '', phone: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);

  const online = useOnlineStatus();

  // Set once a restored draft has been put on screen, so a late-arriving
  // /users/me response cannot overwrite it.
  const draftApplied = useRef(false);

  /*
   * An edited contact email or phone survives a refresh.
   *
   * Same reasoning as the faculty Settings account card: everything else on
   * this screen — theme, density, text size, the notification switches —
   * persists the instant it is touched, so this form is the only thing here
   * that can be lost.
   *
   * The password fields below are deliberately NOT drafted. Writing a password
   * to localStorage would leave it readable on the machine long after the tab
   * is gone, and it survives a sign-out. UserManagement already sets this
   * precedent, drafting its form with `password: ''` stripped out.
   *
   * `serverContact` is the baseline, so a draft is only created once the form
   * differs from what GET /users/me returned.
   */
  const serverContact = useRef({ email: '', phone: '' });

  const contactDraft = useDraft('admin.settings.contact', contact, {
    enabled: !loading,
    /*
     * Applied by hand below. An auto-restore fires when `enabled` flips true,
     * which is the same tick the GET /users/me response calls setContact() —
     * so the draft was restored and then overwritten by the server values.
     * Seen on screen before this was fixed: the draft key was in localStorage
     * but the reloaded form showed the stored phone, not the edited one.
     */
    autoRestore: false,
    isEmpty: (value) => !value
      || (String(value.email ?? '').trim() === String(serverContact.current.email ?? '').trim()
        && String(value.phone ?? '').trim() === String(serverContact.current.phone ?? '').trim()),
  });

  // Applied once, after the account has loaded, so it lands on top.
  useEffect(() => {
    if (loading || draftApplied.current) return;

    /*
     * The flag is set only when a draft is actually APPLIED, never merely
     * because this effect ran.
     *
     * useDraft's own restore effect runs first (it is called earlier in the
     * component body) but publishes `restored` through setState, so on the
     * pass where loading flips false `restoredDraft` is still null here.
     * Marking the work done on that pass meant the draft, which arrives one
     * render later, was never applied — the field kept showing the server
     * value. Verified on screen: the key was in localStorage and the form
     * ignored it.
     *
     * With no draft to restore this simply never fires, which is correct.
     */
    const saved = contactDraft.restoredDraft;
    if (!saved?.value) return;

    draftApplied.current = true;
    setContact(saved.value);
  }, [loading, contactDraft.restoredDraft]);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [pwMessage, setPwMessage] = useState(null);

  const [uploading, setUploading] = useState(false);
  // Whether the shared picker is on screen. It owns the file dialog, the
  // camera, the crop and the confirm; this page owns only the two API calls.
  const [pickerOpen, setPickerOpen] = useState(false);

  /*
   * Whether this account has a picture at all.
   *
   * `has_profile_picture` is derived by the API and is true for both storage
   * locations — the bytes in the row, or the legacy disk path. Testing
   * `profile_picture` directly, as this used to, now reports false for every
   * avatar uploaded since media moved into the database, because that column
   * is left NULL for those.
   */
  const hasAvatar = !!(account?.has_profile_picture || account?.profile_picture);

  /*
   * Re-fetched whenever the account reloads, which is what makes a freshly
   * uploaded picture appear: `uploadPicture` calls load(), the identity of
   * this URL changes, and the hook pulls the new bytes. The cache-buster is
   * the upload timestamp rather than a random value, so an unrelated re-render
   * does not force a re-download.
   */
  const avatarUrl = useAuthedImage(
    hasAvatar && account?.user_id
      ? `/api/users/${account.user_id}/avatar?v=${account.profile_picture_checksum || account.updated_at || ''}`
      : null,
  ).url;

  /*
   * The signed-in account, from the shared cache — the same 'account-me' key
   * the faculty Settings screen reads, so the two never fetch it twice.
   *
   * `contact` stays local state because this card is an edit buffer; the query
   * supplies the baseline and the effect below seeds the fields from it.
   */

  const load = accountQuery.refresh;

  useEffect(() => {
    if (accountQuery.error) { onError(new Error(accountQuery.error)); return; }
    if (!accountQuery.data) return;

    const me = accountQuery.data?.data || accountQuery.data;
    setAccount(me);
    serverContact.current = { email: me?.email || '', phone: me?.phone || '' };

    /*
     * Baseline always; FIELDS only while no draft is on screen.
     *
     * The account response can arrive — or re-arrive, from a background
     * refetch — after a restored draft has been applied. Without this guard it
     * overwrote the restored values and the edit looked lost; observed on
     * screen, with the apply effect confirmed to have run with the right
     * draft.
     */
    if (!draftApplied.current) setContact(serverContact.current);
  }, [accountQuery.data, accountQuery.error, onError]);

  const saveContact = async (e) => {
    e.preventDefault();
    setSavingContact(true);
    try {
      // PUT /api/users/me accepts email and phone only — role and active flags
      // are administrative and stay on the admin route.
      await usersApi.updateMe({ email: contact.email.trim(), phone: contact.phone.trim() });
      // The server now holds what is on screen, so this is the new baseline and
      // the draft is no longer protecting anything.
      serverContact.current = { email: contact.email.trim(), phone: contact.phone.trim() };
      contactDraft.clear();
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 2000);
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setSavingContact(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMessage(null);
    if (pw.next.length < 8) {
      setPwMessage({ tone: 'error', text: 'The new password must be at least 8 characters.' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMessage({ tone: 'error', text: 'The two new passwords do not match.' });
      return;
    }
    setSavingPw(true);
    try {
      await authApi.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwMessage({ tone: 'ok', text: 'Password changed. It applies to your next sign-in.' });
      await load();
    } catch (err) {
      setPwMessage({ tone: 'error', text: err.message || 'Could not change the password.' });
    } finally {
      setSavingPw(false);
    }
  };

  /*
   * These two now run inside the picker dialog, which reports its own success
   * and failure — so the error is RE-THROWN after being handed to onError.
   * Swallowing it, as this did, left the dialog showing "Saving…" and then
   * quietly closing as though the upload had worked.
   *
   * `invalidateAvatar` is what makes the new picture appear everywhere else in
   * the portal rather than only in this card, which reloads its own account.
   */
  const uploadPicture = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      await usersApi.uploadProfilePicture(file);
      if (account?.user_id) invalidateAvatar(account.user_id);
      await load();
    } catch (err) {
      onError(err);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const removePicture = async () => {
    setUploading(true);
    try {
      await usersApi.deleteProfilePicture();
      if (account?.user_id) invalidateAvatar(account.user_id);
      await load();
    } catch (err) {
      onError(err);
      throw err;
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <RouteLoader label="Loading your account…" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Card
        icon={<ImageIcon size={18} style={{ color: '#0891B2' }} />}
        iconBg="#ECFEFF"
        title="Profile picture"
        description="Shown in the header and beside your name across the portal"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%', flexShrink: 0,
            backgroundColor: 'var(--red-accent, #991b1b)', color: '#FFFFFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '1.35rem', overflow: 'hidden', position: 'relative',
          }}>
            {/* The avatar comes from an authenticated API route now, so it
                is fetched with the token and handed over as a blob: URL —
                an <img> cannot carry an Authorization header itself. The
                route serves both database-stored bytes and the legacy disk
                path, so this one address covers every account. */}
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
            <span>{(user?.name || account?.email || 'A').charAt(0).toUpperCase()}</span>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            {/*
              A bare <input type="file"> hidden behind a label used to be the
              whole interface here: pick a file and it was uploaded, uncropped,
              with no preview and no way to frame it. Since every avatar is
              drawn in a circle, whatever the admin chose was then cropped to
              its centre by the browser.

              It now opens the same dialog the student portal uses, so the
              framing step is identical in both places.
            */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={uploading}
              style={{ ...secondaryBtn, cursor: uploading ? 'wait' : 'pointer' }}
            >
              {uploading ? <Loader2 size={14} className="spin" /> : <ImageIcon size={14} />}
              {hasAvatar ? 'Replace' : 'Upload'}
            </button>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, flex: '1 1 200px' }}>
            Position and zoom it in the next step. Stored as a 512&times;512 square.
          </p>
        </div>

        <AvatarUploader
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          currentUrl={avatarUrl}
          name={user?.name || account?.email}
          onUpload={uploadPicture}
          onRemove={hasAvatar ? removePicture : undefined}
        />
      </Card>

      <Card
        icon={<User size={18} style={{ color: 'var(--red-accent, #991b1b)' }} />}
        iconBg="var(--red-accent-light, #FEF2F2)"
        title="Contact details"
        description="The address you sign in with, and the number the institute reaches you on"
        saved={contactSaved}
      >
        <form onSubmit={saveContact} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <DraftNotice
            draft={contactDraft}
            online={online}
            onDiscard={() => setContact(serverContact.current)}
            compact
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={fieldLabel}>Email address</label>
              <input
                type="email"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
                required
                style={fieldInput}
              />
            </div>
            <div>
              <label style={fieldLabel}>Phone</label>
              <input
                type="tel"
                value={contact.phone}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                style={fieldInput}
              />
            </div>
          </div>
          <button type="submit" disabled={savingContact} style={{ ...primaryBtn, alignSelf: 'flex-start' }}>
            {savingContact ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            {savingContact ? 'Saving…' : 'Save contact details'}
          </button>
        </form>
      </Card>

      <Card
        icon={<KeyRound size={18} style={{ color: '#6366F1' }} />}
        iconBg="#EEF2FF"
        title="Password"
        description={account?.last_password_change
          ? `Last changed ${new Date(account.last_password_change).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
          : 'This password has never been changed since it was issued'}
      >
        <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={fieldLabel}>Current password</label>
              <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required style={fieldInput} autoComplete="current-password" />
            </div>
            <div>
              <label style={fieldLabel}>New password</label>
              <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required style={fieldInput} autoComplete="new-password" />
            </div>
            <div>
              <label style={fieldLabel}>Confirm new password</label>
              <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required style={fieldInput} autoComplete="new-password" />
            </div>
          </div>

          {pwMessage && (
            <div style={{
              padding: '0.6rem 0.85rem', borderRadius: '9px', fontSize: '0.8rem', fontWeight: 600,
              backgroundColor: pwMessage.tone === 'ok' ? '#ECFDF5' : '#FEF2F2',
              border: `1px solid ${pwMessage.tone === 'ok' ? '#A7F3D0' : '#FECACA'}`,
              color: pwMessage.tone === 'ok' ? '#065F46' : '#B91C1C',
            }}>
              {pwMessage.text}
            </div>
          )}

          <button type="submit" disabled={savingPw} style={{ ...primaryBtn, alignSelf: 'flex-start' }}>
            {savingPw ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
            {savingPw ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </Card>
    </div>
  );
}

/* ── About ───────────────────────────────────────────────────────────────
   Facts that can be checked. The panel this replaces reported a version
   ("v3.2.1 Build 2026.07.26"), an environment ("Production") and a backup
   ("today, Auto") that were all written into the JSX by hand. */
function AboutPanel({ user }) {
  const [account, setAccount] = useState(null);

  useEffect(() => {
    usersApi.me().then((res) => setAccount(res?.data || res)).catch(() => {});
  }, []);

  const rows = useMemo(() => ([
    ['Signed in as', account?.email || user?.email || '—'],
    ['Role', user?.roleName || '—'],
    ['Account ID', account?.user_id ?? '—'],
    ['Last sign-in', account?.last_login
      ? new Date(account.last_login).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'This session is the first'],
    ['Password last changed', account?.last_password_change
      ? new Date(account.last_password_change).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Never changed since issue'],
    ['Failed sign-in attempts', account?.failed_login_attempts ?? 0],
    ['Account created', account?.created_at
      ? new Date(account.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : '—'],
  ]), [account, user]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Card
        icon={<Info size={18} style={{ color: '#2563EB' }} />}
        iconBg="#EFF6FF"
        title="This account"
        description="Read from your own user record"
      >
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.6rem 1rem', fontSize: '0.85rem' }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{label}</dt>
              <dd style={{ margin: 0, textAlign: 'right', fontWeight: 700, color: 'var(--text-dark)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card
        icon={<AlertTriangle size={18} style={{ color: '#D97706' }} />}
        iconBg="#FEF3C7"
        title="Settings that are not here"
        description="Deliberately, so the screen does not claim more than the system does"
      >
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.75 }}>
          <li><strong>Language</strong> — there is no translation layer, so a language choice would change nothing.</li>
          <li><strong>Date format and timezone</strong> — dates are formatted by the browser's own locale; no setting reaches a formatter.</li>
          <li><strong>Email and SMS alerts</strong> — this project has no mail transport and no SMS gateway.</li>
          <li><strong>Institute name and academic year</strong> — nothing reads them; the academic calendar lives in the <em>semesters</em> table.</li>
          <li><strong>Two-factor authentication</strong> — not implemented in the authentication service.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Card({ icon, iconBg, title, description, saved, children }) {
  return (
    <section style={{
      backgroundColor: 'var(--surface, #FFFFFF)', borderRadius: '14px',
      border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)',
      padding: '1.35rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.8rem', marginBottom: '1.1rem' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
          backgroundColor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-dark)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {title}
            {saved && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: '0.7rem', fontWeight: 700, color: '#065F46',
                backgroundColor: '#D1FAE5', padding: '0.1rem 0.45rem', borderRadius: '9999px',
              }}>
                <Check size={11} /> Saved
              </span>
            )}
          </h3>
          <p style={{ fontSize: '0.79rem', color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: 1.5 }}>
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

/*
 * A segmented control rather than a <select>: there are only three options,
 * they are mutually exclusive, and the effect is immediate and visible — so
 * showing all three at once and letting one click switch between them beats
 * hiding two of them behind a dropdown.
 */
function ChoiceRow({ options, value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: '0.6rem' }}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px',
              padding: '0.7rem 0.85rem', borderRadius: '11px', cursor: 'pointer',
              border: `1.5px solid ${active ? 'var(--red-accent, #991b1b)' : 'var(--border-light)'}`,
              backgroundColor: active ? 'var(--red-accent-light, #FEF2F2)' : 'transparent',
              textAlign: 'left', transition: 'border-color 0.15s, background-color 0.15s',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-dark)' }}>
              {Icon && <Icon size={14} />}
              {opt.label}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
              {opt.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: '2px', accentColor: '#991b1b', cursor: 'pointer' }}
      />
      <span>
        <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-dark)' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{hint}</span>}
      </span>
    </label>
  );
}

const fieldLabel = {
  display: 'block', fontSize: '0.73rem', fontWeight: 700,
  color: 'var(--text-muted)', marginBottom: '4px',
};

const fieldInput = {
  width: '100%', padding: '0.6rem 0.8rem', borderRadius: '9px',
  border: '1px solid var(--border-light)', fontSize: '0.86rem',
  outline: 'none', boxSizing: 'border-box',
  backgroundColor: 'var(--surface, #FFFFFF)', color: 'var(--text-dark)',
};

const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '0.6rem 1.1rem', borderRadius: '9px', border: 'none',
  backgroundColor: '#991b1b', color: '#FFFFFF', fontWeight: 700,
  fontSize: '0.83rem', cursor: 'pointer',
};

const secondaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '0.5rem 0.9rem', borderRadius: '9px',
  border: '1px solid var(--border-light)', backgroundColor: 'transparent',
  color: 'var(--text-dark)', fontWeight: 700, fontSize: '0.8rem',
};
