import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { auth as authApi } from '../api/endpoints';
import { landingPathForRole } from '../api/roles';

/*
 * The forced first sign-in password change.
 *
 * Anyone whose account still holds a password an administrator generated lands
 * here and cannot leave until they set their own — ProtectedRoute redirects
 * every other route back to this one while `mustChangePassword` is true.
 *
 * Why it has to exist: admitting a student creates their login and their
 * parent's, and shows both passwords to the admin so they can be handed over.
 * That is the only practical way to get someone their first credential, but it
 * means a second person has seen it. This screen is what closes that window.
 *
 * There is no "skip" button, and no sign-out shortcut that leaves the flag set:
 * the only way past is to choose a password.
 */

const RULES = [
  { test: (v) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v), label: 'Upper and lower case' },
  { test: (v) => /\d/.test(v), label: 'At least one number' },
];

export default function ChangePassword() {
  const { user, clearMustChangePassword, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const met = RULES.map((r) => r.test(newPassword));
  const allMet = met.every(Boolean);
  const matches = newPassword.length > 0 && newPassword === confirm;

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!allMet) return setError('The new password does not meet the requirements.');
    if (!matches) return setError('The two new passwords do not match.');
    if (newPassword === currentPassword) {
      return setError('The new password must be different from the issued one.');
    }

    setSaving(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);

      // The backend clears must_change_password in the same request; mirror it
      // locally so the guard stops redirecting.
      clearMustChangePassword();
      navigate(landingPathForRole(user?.roleId), { replace: true });

    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px',
    border: '1px solid #CBD5E1', fontSize: '0.9rem', outline: 'none',
    boxSizing: 'border-box', marginTop: '5px',
  };

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: '#F8FAFC', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
    }}>
      <form
        onSubmit={submit}
        style={{
          backgroundColor: 'white', borderRadius: '18px', width: '100%',
          maxWidth: '440px', border: '1px solid #E2E8F0', overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
        }}
      >
        <div style={{ padding: '1.5rem 1.75rem 1rem', borderBottom: '1px solid #F1F5F9' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px',
            backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#D97706', marginBottom: '0.85rem',
          }}>
            <KeyRound size={22} />
          </div>
          <h1 style={{
            fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', margin: 0,
            fontFamily: "'Outfit', sans-serif",
          }}>
            Choose your password
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '6px 0 0', lineHeight: 1.5 }}>
            Your account was set up with a password issued by the administration
            office, so somebody else has seen it. Pick your own to continue —
            you will not be asked again.
          </p>
        </div>

        <div style={{ padding: '1.25rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
              padding: '0.6rem 0.85rem', borderRadius: '10px',
              backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
              color: '#991B1B', fontSize: '0.82rem',
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
              {error}
            </div>
          )}

          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
            The password you were given
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={inputStyle}
            />
          </label>

          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              style={inputStyle}
            />
          </label>

          {/* Live requirements, so nobody has to guess why Save is disabled. */}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {RULES.map((rule, i) => (
              <li key={rule.label} style={{
                fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px',
                color: met[i] ? '#059669' : '#94A3B8', fontWeight: met[i] ? 600 : 500,
              }}>
                <ShieldCheck size={12} /> {rule.label}
              </li>
            ))}
          </ul>

          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
            Confirm new password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              style={{
                ...inputStyle,
                borderColor: confirm && !matches ? '#FCA5A5' : '#CBD5E1',
              }}
            />
          </label>
        </div>

        <div style={{
          padding: '1rem 1.75rem 1.5rem', display: 'flex',
          flexDirection: 'column', gap: '0.6rem',
        }}>
          <button
            type="submit"
            disabled={saving || !allMet || !matches || !currentPassword}
            style={{
              padding: '0.7rem', borderRadius: '10px', border: 'none',
              backgroundColor: saving || !allMet || !matches || !currentPassword ? '#CBD5E1' : '#991b1b',
              color: 'white', fontWeight: 700, fontSize: '0.9rem',
              cursor: saving || !allMet || !matches || !currentPassword ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            }}
          >
            {saving && <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} />}
            {saving ? 'Saving…' : 'Set password and continue'}
          </button>

          {/* Signing out is allowed; skipping is not. The flag stays set, so
              the next sign-in lands back here. */}
          <button
            type="button"
            onClick={logout}
            style={{
              padding: '0.5rem', borderRadius: '10px', border: 'none',
              background: 'none', color: '#64748B', fontWeight: 600,
              fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Sign out instead
          </button>
        </div>
      </form>
    </div>
  );
}
