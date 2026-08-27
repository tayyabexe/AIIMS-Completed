import { useEffect, useRef, useState } from 'react';
import { useServerQuery } from '../../hooks/useAdminPage';
import { Bell, Shield, Palette, Save } from 'lucide-react';
import Layout from '../../components/faculty/Layout.jsx';
import { useToast } from '../../components/faculty/Toast.jsx';
import { usePreferences } from '../../context/PreferencesContext.jsx';
import { useFacultyBadges } from '../../context/FacultyBadgeContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { users as usersApi } from '../../api/endpoints';
import useDraft, { useOnlineStatus } from '../../hooks/useDraft';
import DraftNotice from '../../components/common/DraftNotice';
import './Settings.css';

/*
 * Settings, backed by the API.
 *
 * What this screen used to be
 * ---------------------------
 * Every control was React state with a hardcoded initial value, and "Save
 * Changes" only raised a toast — nothing on this page survived a reload, and
 * the Account card shipped with somebody's name in it
 * ("sarah.ahmed@aims.edu.pk", "+92-321-4567890") no matter who was signed in.
 *
 * What was removed, and why
 * -------------------------
 *   "Email me when attendance is pending"
 *   "Email me about marks submission deadlines"
 *   "Email me when a new announcement is posted"
 *   "Push reminders for upcoming classes"
 *   "Weekly summary digest"
 *     - this project has no mail transport and no push service, so none of
 *       these five could ever have sent anything. A switch that cannot act is
 *       worse than no switch: it tells the teacher they will be emailed.
 *
 *   "Layout Density"
 *     - no stylesheet in the portal reads a density setting.
 *
 *   "Language & Region"
 *     - there is no translation layer, and the time zone is fixed by the
 *       server (see backend/src/config/timetableSlots.js), not chosen per user.
 *
 *   "Demo Data" / "Reset Demo Data"
 *     - left over from when this portal ran on a generated localStorage
 *       dataset. It reads the live database now, so there is no demo data to
 *       reset.
 *
 * What is left is enforced somewhere real: the two badge switches drive the
 * sidebar bubbles, the category switches filter the notification feed on the
 * server, Theme is applied by ThemeContext, and Account writes to `users`.
 */

export default function Settings() {
  const showToast = useToast();
  const { preferences, loading: prefsLoading, save } = usePreferences();
  const { notifications } = useFacultyBadges();
  const { theme, setTheme } = useTheme();

  const mounted = useRef(true);
  // Raised on mount as well as lowered on unmount — see api/notificationsData.js.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // --- account --------------------------------------------------------------
  // GET /api/users/me — the signed-in account, resolved from the token.
  //
  // Set once a restored draft has been put on screen, so a late-arriving
  // account response cannot overwrite it. Declared here because loadAccount
  // below reads it; the effect that sets it is further down, with the draft.
  const draftApplied = useRef(false);
  const [account, setAccount] = useState({ email: '', phone: '' });

  /*
   * The signed-in account, from the shared cache.
   *
   * `account` above stays local because this card is an EDIT BUFFER — the same
   * reason the student profile keeps one. The query supplies the baseline; the
   * effect below seeds the fields from it, and only while no draft is on
   * screen.
   */
  const accountQuery = useServerQuery(
    // No heartbeat: it seeds the contact fields, and a refetch arriving
    // mid-edit would overwrite what is being typed.
    () => usersApi.me(), {}, { key: 'account-me', live: false },
  );

  const accountLoading = accountQuery.loading;
  const accountError = accountQuery.error;

  useEffect(() => {
    if (!accountQuery.data) return;

    serverAccount.current = {
      email: accountQuery.data?.data?.email || '',
      phone: accountQuery.data?.data?.phone || '',
    };

    /*
     * The baseline is always updated; the FIELDS are only seeded while no
     * draft has been put on screen.
     *
     * This guard is what makes the draft restore stick. The account response
     * can arrive — or re-arrive, from a background refetch — after a restored
     * draft has been applied, and without this it overwrote the restored
     * values with the server's and the edit appeared to vanish. Traced on
     * screen before it was fixed: the apply effect ran with the correct draft
     * and the field still showed the stored phone number.
     */
    if (!draftApplied.current) setAccount(serverAccount.current);
  }, [accountQuery.data]);

  const [saving, setSaving] = useState(false);
  const online = useOnlineStatus();

  /*
   * An edited contact email or phone survives a refresh.
   *
   * Only two fields, but they are the two that matter most on this screen:
   * `email` is the sign-in identity and `phone` is the recovery route, so a
   * change here is deliberate and usually typed from something the person had
   * to go and look up. Every other control on this page persists the moment it
   * is flipped — this card is the one that needs an explicit Save, which makes
   * it the only one that can be lost.
   *
   * `serverAccount` is the baseline. The account arrives from GET /users/me,
   * so the form is never literally empty; a draft is only worth keeping once
   * what is on screen differs from what the server sent, otherwise merely
   * opening Settings would leave one behind.
   */
  const serverAccount = useRef({ email: '', phone: '' });

  const accountDraft = useDraft('faculty.settings.account', account, {
    enabled: !accountLoading,
    /*
     * Applied by hand below, not automatically.
     *
     * loadAccount() calls setAccount() with the server's values when its
     * request resolves. An auto-restore fires the moment `enabled` flips true,
     * which is the same tick — so the restored draft was written and then
     * immediately overwritten by the response. Caught on screen: the draft key
     * appeared in localStorage but the field showed the stored phone number
     * after a reload, not the edited one.
     *
     * The marks sheet has the same shape and solves it the same way.
     */
    autoRestore: false,
    isEmpty: (value) => !value
      || (String(value.email ?? '').trim() === String(serverAccount.current.email ?? '').trim()
        && String(value.phone ?? '').trim() === String(serverAccount.current.phone ?? '').trim()),
  });

  // Applies a restored draft once, after the account has loaded, so it lands on
  // top of the server values rather than under them.
  useEffect(() => {
    if (accountLoading || draftApplied.current) return;

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
    const saved = accountDraft.restoredDraft;
    if (!saved?.value) return;

    draftApplied.current = true;
    setAccount(saved.value);
  }, [accountLoading, accountDraft.restoredDraft]);

  const notif = preferences.notifications;

  const toggleNotif = (key) => {
    save({ notifications: { [key]: !notif[key] } });
  };

  const toggleType = (type) => {
    const muted = notif.mutedTypes.includes(type)
      ? notif.mutedTypes.filter((t) => t !== type)
      : [...notif.mutedTypes, type];

    save({ notifications: { mutedTypes: muted } });
  };

  const changeTheme = (next) => {
    // Applied immediately so the page repaints as the teacher picks, then
    // stored against the account so it follows them to another machine.
    setTheme(next);
    save({ appearance: { theme: next } });
  };

  /**
   * Only the Account card needs an explicit save — it writes to `users`, and
   * a request per keystroke is not wanted. The switches above persist as they
   * are flipped.
   */
  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAccountError(null);

    try {
      const res = await usersApi.updateMe({
        email: account.email.trim(),
        phone: account.phone.trim() || null,
      });
      if (res?.data) {
        serverAccount.current = { email: res.data.email || '', phone: res.data.phone || '' };
        setAccount(serverAccount.current);
      }
      // Saved, so the draft has done its job. A failed save falls through to
      // the catch and keeps it.
      accountDraft.clear();
      showToast('Account details saved');
    } catch (err) {
      if (mounted.current) setAccountError(err.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const types = notifications?.availableTypes || [];

  return (
    <Layout title="Settings">
      <form className="settings-wrap" onSubmit={handleSave}>
        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><Bell size={17} /></span>
            <div>
              <h3>Notifications</h3>
              <p>What the portal flags for you, and which categories reach your feed.</p>
            </div>
          </div>
          <div className="settings-toggle-list">
            <ToggleRow
              label="Show a bubble for unread notifications"
              hint="On the bell and the Notifications item in the sidebar."
              checked={notif.unreadBadge}
              disabled={prefsLoading}
              onChange={() => toggleNotif('unreadBadge')}
            />
            <ToggleRow
              label="Show a bubble for new assignments"
              hint="Counts assignments set on your subjects since you last opened that screen."
              checked={notif.assignmentBadge}
              disabled={prefsLoading}
              onChange={() => toggleNotif('assignmentBadge')}
            />
          </div>

          <div className="settings-subhead">
            <h4>Categories in my feed</h4>
            <p>
              {types.length
                ? 'Switching a category off hides it from your notifications and its unread count.'
                : 'You have not received any notifications yet, so there are no categories to filter.'}
            </p>
          </div>

          {types.length > 0 && (
            <div className="settings-toggle-list">
              {types.map((type) => (
                <ToggleRow
                  key={type}
                  label={type}
                  checked={!notif.mutedTypes.includes(type)}
                  disabled={prefsLoading}
                  onChange={() => toggleType(type)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><Palette size={17} /></span>
            <div>
              <h3>Appearance</h3>
              <p>Applied straight away and saved to your account.</p>
            </div>
          </div>
          <div className="settings-grid-2">
            <div className="filter-field">
              <label>Theme</label>
              <select value={theme} onChange={(e) => changeTheme(e.target.value)} disabled={prefsLoading}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">Match System</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><Shield size={17} /></span>
            <div>
              <h3>Account</h3>
              <p>Contact details used for sign-in and account recovery.</p>
            </div>
          </div>
          <DraftNotice
            draft={accountDraft}
            online={online}
            onDiscard={() => setAccount(serverAccount.current)}
            compact
          />
          <div className="settings-grid-2">
            <div className="filter-field">
              <label>Contact Email</label>
              <input
                type="email"
                value={account.email}
                disabled={accountLoading}
                placeholder={accountLoading ? 'Loading…' : ''}
                onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))}
                required
              />
            </div>
            <div className="filter-field">
              <label>Phone Number</label>
              <input
                type="text"
                maxLength={20}
                value={account.phone}
                disabled={accountLoading}
                onChange={(e) => setAccount((a) => ({ ...a, phone: e.target.value }))}
              />
            </div>
          </div>
          {accountError && <div className="settings-error">{accountError}</div>}
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || accountLoading}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save Account Details'}
          </button>
        </div>
      </form>
    </Layout>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span>
        {label}
        {hint && <em className="settings-toggle-hint">{hint}</em>}
      </span>
      <button
        type="button"
        className={`settings-switch${checked ? ' on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
      >
        <span className="settings-switch-knob" />
      </button>
    </label>
  );
}
