import { useEffect, useRef, useState } from 'react';
import { KeyRound, Eye, EyeOff, ShieldCheck, AlertCircle, Check, X, Loader2 } from 'lucide-react';
import { auth as authApi } from '../../api/endpoints';

/*
 * The routine "I would like a new password" dialog.
 *
 * NOT the same thing as pages/ChangePassword.jsx. That screen is the FORCED
 * first change: it is a whole route, it has no cancel, and it exists because
 * the account is still holding a password an administrator read off a screen.
 * This is the ordinary one a signed-in user opens from their own profile at any
 * time, and it can be dismissed.
 *
 * It was extracted because the parent portal had neither. A parent's login is
 * provisioned by the admission flow exactly like a student's, so a parent needs
 * both halves — the forced change on first sign-in, and this, for every time
 * after. The student portal already had its own copy inside Profile.jsx and the
 * faculty portal another inside its Profile.jsx; this is the shared one, so a
 * fourth copy is not written the next time a portal needs it.
 *
 * Both halves call the same endpoint, PUT /api/auth/change-password, which is
 * role-independent and clears must_change_password for whoever presents a valid
 * token.
 */

const RULES = [
  { test: (v) => v.length >= 8, label: 'At least 8 characters' },
  { test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v), label: 'Upper and lower case' },
  { test: (v) => /\d/.test(v), label: 'At least one number' },
];

const RED = '#991b1b';

/**
 * @param {boolean}  open      whether the dialog is mounted
 * @param {function} onClose   called on cancel, on Escape, and after a success
 * @param {function} [onDone]  called once the server has accepted the change
 */
export default function ChangePasswordDialog({ open, onClose, onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const firstFieldRef = useRef(null);

  // Fresh every time it opens. Leaving the previous attempt's values behind
  // would mean re-opening the dialog showed a typed-in password.
  useEffect(() => {
    if (!open) return undefined;

    setCurrent(''); setNext(''); setConfirm('');
    setError(''); setDone(false); setSaving(false); setReveal(false);

    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);

    // Focus lands on the first field rather than on the backdrop, so the
    // keyboard is usable without a Tab first.
    const t = setTimeout(() => firstFieldRef.current?.focus(), 60);

    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open, onClose]);

  if (!open) return null;

  const met = RULES.map((r) => r.test(next));
  const allMet = met.every(Boolean);
  const matches = next.length > 0 && next === confirm;
  const ready = allMet && matches && current.length > 0 && next !== current;

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (next === current) return setError('The new password must be different from the current one.');
    if (!allMet) return setError('The new password does not meet the requirements.');
    if (!matches) return setError('The two new passwords do not match.');

    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      setDone(true);
      onDone?.();
      // Held on screen for a beat so the confirmation is actually seen; a
      // dialog that vanishes the instant it succeeds reads as a failure.
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(err.message || 'Could not change your password.');
    } finally {
      setSaving(false);
    }
  };

  const field = {
    width: '100%', padding: '0.65rem 2.4rem 0.65rem 0.85rem', borderRadius: '10px',
    border: '1px solid #CBD5E1', fontSize: '0.9rem', outline: 'none',
    boxSizing: 'border-box', marginTop: '5px', fontFamily: "'Inter', sans-serif",
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };

  const focusRing = (e) => {
    e.target.style.borderColor = RED;
    e.target.style.boxShadow = '0 0 0 3px rgba(153,27,27,0.10)';
  };
  const blurRing = (e) => {
    e.target.style.borderColor = '#CBD5E1';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
        animation: 'aimsFadeIn 0.18s ease-out',
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          backgroundColor: 'white', borderRadius: '18px', width: '100%', maxWidth: '440px',
          border: '1px solid #E2E8F0', overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
          animation: 'aimsPopIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{
          padding: '1.35rem 1.6rem 1rem', borderBottom: '1px solid #F1F5F9',
          display: 'flex', alignItems: 'flex-start', gap: '12px',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
            backgroundColor: '#FEF2F2', color: RED,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <KeyRound size={19} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
              Change password
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '3px 0 0', lineHeight: 1.5 }}>
              You will stay signed in on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: '#F1F5F9', border: 'none', borderRadius: '9px', cursor: 'pointer',
              width: '30px', height: '30px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#64748B', transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#E2E8F0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#F1F5F9'; }}
          >
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div style={{ padding: '2.2rem 1.6rem', textAlign: 'center' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%', margin: '0 auto',
              backgroundColor: '#ECFDF5', color: '#059669',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'aimsPopIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
              <Check size={26} />
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: '0.9rem 0 0', fontFamily: "'Outfit', sans-serif" }}>
              Password changed
            </p>
            <p style={{ fontSize: '0.8rem', color: '#64748B', margin: '4px 0 0' }}>
              Use your new password the next time you sign in.
            </p>
          </div>
        ) : (
          <>
            <div style={{ padding: '1.15rem 1.6rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {error && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                  padding: '0.6rem 0.85rem', borderRadius: '10px',
                  backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
                  color: '#991B1B', fontSize: '0.82rem',
                  animation: 'aimsShake 0.3s ease-out',
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                  {error}
                </div>
              )}

              {[
                { label: 'Current password', value: current, set: setCurrent, ref: firstFieldRef, autoComplete: 'current-password' },
                { label: 'New password', value: next, set: setNext, autoComplete: 'new-password' },
                { label: 'Confirm new password', value: confirm, set: setConfirm, autoComplete: 'new-password' },
              ].map((f) => (
                <label key={f.label} style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', position: 'relative', display: 'block' }}>
                  {f.label}
                  <input
                    ref={f.ref}
                    type={reveal ? 'text' : 'password'}
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    onFocus={focusRing}
                    onBlur={blurRing}
                    autoComplete={f.autoComplete}
                    required
                    style={{
                      ...field,
                      borderColor: f.label.startsWith('Confirm') && confirm && !matches ? '#FCA5A5' : '#CBD5E1',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
                    style={{
                      position: 'absolute', right: '10px', top: '31px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#94A3B8', padding: 0, lineHeight: 0,
                    }}
                  >
                    {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </label>
              ))}

              {/* Live rules. Each one ticks over as it is satisfied, so nobody
                  has to work out why the button is still grey. */}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {RULES.map((rule, i) => (
                  <li key={rule.label} style={{
                    fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '6px',
                    color: met[i] ? '#059669' : '#94A3B8', fontWeight: met[i] ? 600 : 500,
                    transition: 'color 0.2s',
                  }}>
                    <ShieldCheck size={12} /> {rule.label}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ padding: '0.9rem 1.6rem 1.4rem', display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: '0 0 auto', padding: '0.7rem 1.1rem', borderRadius: '10px',
                  border: '1px solid #E2E8F0', background: 'white', color: '#475569',
                  fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !ready}
                style={{
                  flex: 1, padding: '0.7rem', borderRadius: '10px', border: 'none',
                  backgroundColor: saving || !ready ? '#CBD5E1' : RED,
                  color: 'white', fontWeight: 700, fontSize: '0.88rem',
                  cursor: saving || !ready ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                  transition: 'background-color 0.2s, transform 0.1s',
                }}
                onMouseDown={(e) => { if (ready && !saving) e.currentTarget.style.transform = 'scale(0.98)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                {saving && <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} />}
                {saving ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
