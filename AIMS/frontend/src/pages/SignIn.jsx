import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Lock, EnvelopeSimple, Eye, EyeSlash, ArrowLeft, ArrowRight,
  Check, WarningCircle, GraduationCap,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { PORTALS, resolvePortal } from '../lib/portals';
import { useViewportLock } from '../components/stage/Stage';
import '../styles/auth.css';

/**
 * Sign-in, shared by all four portals.
 *
 * Intent      One person, at the door, holding one credential. Everything on
 *             this screen either helps them present it or tells them why it
 *             was refused.
 * Hierarchy   The form is the focal element and sits on the only pure-white
 *             surface on the page; the ink pane beside it establishes which
 *             portal this is and then stops competing.
 *
 * WHAT WAS REMOVED, AND WHY
 * The screen used to be a demo rig wearing a login's clothes. It shipped the
 * working email and password of a real seed account in a "Demo Credentials"
 * panel and pre-filled both fields with them; the parent portal added a
 * dropdown of every parent in the database, by name and by child, to anyone
 * who loaded the page — before authenticating. It also asserted things that
 * were never true: "12,000+ students managed", a "Last login: Today 08:30 AM"
 * that was a string constant, and a "Secure & Encrypted Login" badge that
 * described nothing the page did. A "Remember me for 30 days" checkbox was
 * wired to state that no code read.
 *
 * All of it is gone. The fields start empty, the copy states only what the
 * portal actually does, and the one claim left on the page — that an account
 * from another portal will be refused here — is enforced server-side.
 *
 * (The parent dropdown also called a `handleSelectParent` that was never
 * defined, so choosing a parent threw. Deleting the control removes the bug.)
 */
export default function SignIn() {
  /* One question per screen, so nothing sits below the fold and no scrollbar
     offers to go looking for it. Falls back to normal flow on short or narrow
     viewports, where the form genuinely needs the room. */
  useViewportLock();

  const { loginAsAdmin, loginAsParent, authLoading } = useAuth();
  const navigate = useNavigate();
  const { portal } = useParams();

  const config = resolvePortal(portal);
  // The bare /sign-in route has no parameter and falls back to admin.
  const activePortal = PORTALS[portal] ? portal : 'admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const errorRef = useRef(null);

  // Switching portals mid-session clears the form: credentials do not carry
  // across doors, and leaving them behind only invites a refused attempt.
  useEffect(() => {
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setFormError('');
  }, [portal]);

  // The alert is not mounted while handleSubmit runs, so the focus has to
  // wait for it — otherwise a screen reader is never moved to the reason.
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!email.trim() || !password) {
      setFormError('Enter your email address and password.');
      return;
    }

    // The chosen portal is passed through so an account belonging to a
    // different one is refused rather than quietly redirected.
    const result = portal === 'parent'
      ? await loginAsParent(email.trim(), password)
      : await loginAsAdmin(email.trim(), password, activePortal);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    navigate(result.redirectTo || config.signInTo, { replace: true });
  };

  const hueVars = {
    '--hue': config.hue,
    '--hue-soft': config.hueSoft,
    '--hue-on-ink': config.hueOnInk,
  };

  return (
    <div className="aims-auth">
      <div
        className="auth-field auth-field--locked"
        style={{ '--aura': config.aura }}
      >
        <div className="signin-split">
          {/* ── Ink pane: which door this is ─────────────────────────── */}
          <aside className="signin-ink" style={hueVars}>
            <div className="signin-ink__glow" />

            <div style={{ position: 'relative', zIndex: 1 }}>
              <button
                type="button"
                className="auth-mark auth-mark--invert"
                onClick={() => navigate('/choose-portal')}
                title="Back to portal selection"
              >
                <span className="auth-mark__seal"><GraduationCap size={21} weight="fill" /></span>
                <span>
                  <span className="auth-mark__name">AIIMS</span>
                  <span className="auth-mark__sub">Institute Management</span>
                </span>
              </button>

              <h1 className="t-display balance" style={{ color: '#ffffff', marginTop: 'clamp(32px, 6vh, 56px)' }}>
                {config.label}
              </h1>
              <p
                className="t-body-lg pretty"
                style={{ color: 'var(--primary-fixed)', marginTop: '12px', maxWidth: '42ch' }}
              >
                {config.desc}
              </p>

              <ul
                style={{
                  listStyle: 'none',
                  margin: '32px 0 0',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {config.duties.map((duty) => (
                  <li
                    key={duty}
                    className="t-body"
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', color: 'var(--primary-fixed)' }}
                  >
                    <span className="signin-tick"><Check size={12} weight="bold" /></span>
                    {duty}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* ── Form pane ────────────────────────────────────────────── */}
          <section className="signin-form">
            <div className="signin-card rise">
              <header style={{ marginBottom: '28px' }}>
                <p className="t-eyebrow">{config.label}</p>
                <h2 className="t-h1" style={{ marginTop: '10px' }}>Sign in</h2>
                <p className="t-body ink-2" style={{ marginTop: '6px' }}>
                  Use the account issued to you for the {config.label.toLowerCase()}.
                </p>
              </header>

              <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div className="fld">
                  <label className="fld__label" htmlFor="signin-email">Email address</label>
                  <div className="fld__wrap">
                    <EnvelopeSimple size={18} className="fld__icon" aria-hidden="true" />
                    <input
                      id="signin-email"
                      className="fld__input"
                      type="email"
                      name="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck="false"
                      placeholder="you@aims.edu.pk"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={formError ? 'true' : undefined}
                    />
                  </div>
                </div>

                <div className="fld">
                  <div className="fld__row">
                    <label className="fld__label" htmlFor="signin-password">Password</label>
                    <Link className="lnk" to={`/forgot-password?role=${activePortal}`}>Forgot password?</Link>
                  </div>
                  <div className="fld__wrap">
                    <Lock size={18} className="fld__icon" aria-hidden="true" />
                    <input
                      id="signin-password"
                      className="fld__input fld__input--reveal"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete="current-password"
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={formError ? 'true' : undefined}
                    />
                    <button
                      type="button"
                      className="fld__reveal"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Focused on failure so a screen reader lands on the reason. */}
                <div aria-live="polite">
                  {formError && (
                    <div className="alert" role="alert" tabIndex={-1} ref={errorRef}>
                      <WarningCircle size={16} weight="fill" aria-hidden="true" />
                      <span>{formError}</span>
                    </div>
                  )}
                </div>

                <button type="submit" className="btn btn--primary btn--block" disabled={authLoading}>
                  {authLoading ? 'Signing in…' : (<>Sign in <ArrowRight size={16} weight="bold" /></>)}
                </button>

                {/*
                  Shown always, not only after a failure. A refused sign-in says
                  the same thing whatever went wrong — wrong password, unknown
                  address, or the right password on the wrong portal — because a
                  message that appeared only in that last case would confirm the
                  password was correct. A standing note costs nothing and reaches
                  the confused user before they have spent an attempt.
                */}
                <p className="t-body-sm ink-3 pretty" style={{ lineHeight: '18px' }}>
                  Accounts are issued per portal. An account for another portal will not be
                  accepted here —{' '}
                  <button type="button" className="lnk" style={{ fontSize: '12px' }} onClick={() => navigate('/choose-portal')}>
                    choose a different portal
                  </button>.
                </p>

                {activePortal === 'admin' && (
                  <>
                    <div className="rule" style={{ marginTop: '4px' }}>New to AIIMS?</div>
                    <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate('/admin-signup')}>
                      Create an administrator account
                    </button>
                  </>
                )}
              </form>
            </div>

            <button type="button" className="btn btn--quiet" onClick={() => navigate('/choose-portal')} style={{ marginTop: '16px' }}>
              <ArrowLeft size={15} weight="bold" /> All portals
            </button>
          </section>
        </div>
      </div>

      <style>{`
        .aims-auth .signin-split {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          flex: 1;
          min-height: 100vh;
          min-height: 100dvh;
        }
        .aims-auth .signin-ink {
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 40px;
          padding: clamp(28px, 5vw, 56px);
          padding-top: max(clamp(28px, 5vw, 56px), env(safe-area-inset-top));
          background: linear-gradient(155deg, #00174b 0%, #002f80 55%, #003ea8 100%);
          color: #ffffff;
        }
        /* A single aura in the portal's own hue — the one place the ink pane
           takes colour from the credential rather than from the brand. */
        .aims-auth .signin-ink__glow {
          position: absolute;
          top: -18%;
          right: -20%;
          width: 520px;
          height: 520px;
          border-radius: 9999px;
          background: var(--hue);
          opacity: .38;
          filter: blur(120px);
          pointer-events: none;
        }
        .aims-auth .signin-tick {
          width: 20px;
          height: 20px;
          flex: none;
          margin-top: 1px;
          display: grid;
          place-items: center;
          border-radius: 9999px;
          background: rgba(255, 255, 255, .14);
          border: 1px solid rgba(255, 255, 255, .22);
          color: var(--hue-on-ink);
        }
        .aims-auth .signin-form {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(32px, 6vw, 64px) 20px;
          padding-bottom: max(clamp(32px, 6vw, 64px), env(safe-area-inset-bottom));
        }
        /* Concentric: 24px inner radius over 28px padding on the fields'
           8px corners, so nothing nests at the same curvature. */
        .aims-auth .signin-card {
          width: 100%;
          max-width: 440px;
          padding: clamp(24px, 4vw, 36px);
          background: var(--surface-container-lowest);
          border: 1px solid var(--outline-variant);
          border-radius: var(--r-xl);
          box-shadow: var(--lift-1);
        }

        @media (min-width: 980px) {
          .aims-auth .signin-split { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
        }
        /* Below the split, the ink pane becomes a compact banner: the duty
           list would push the form off a phone screen. */
        @media (max-width: 979px) {
          .aims-auth .signin-ink { gap: 24px; }
          .aims-auth .signin-ink ul { display: none; }
          .aims-auth .signin-ink .t-display { margin-top: 24px; }
        }
      `}</style>
    </div>
  );
}
