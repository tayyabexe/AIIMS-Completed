import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Key, ArrowLeft, MapPin, Phone, GraduationCap } from '@phosphor-icons/react';
import { PORTALS, PORTAL_ORDER } from '../lib/portals';
import { useViewportLock } from '../components/stage/Stage';
import '../styles/auth.css';

/**
 * Password recovery.
 *
 * WHAT THIS PAGE USED TO DO
 * It presented a four-step "send OTP → verify code → set new password →
 * success" wizard that was entirely simulated. No code was ever sent, any four
 * digits were accepted, the new password was never submitted anywhere, and the
 * page then told the user "Password Reset Complete!". Anyone who used it was
 * locked out just the same, believing their password had changed.
 *
 * WHAT IT DOES NOW
 * AIMS has no email delivery configured, so there is no way to prove somebody
 * owns an address without a person in the loop. Password resets are therefore
 * handled by the admin office, and this page says so and shows how to reach
 * them. Signed-in users can still change their own password from their
 * profile, which verifies the current one server-side.
 */

// Who to contact, per portal. Admins are reset by a Super Admin rather than by
// the same office that resets everyone else.
const CONTACT = {
  student: {
    who: 'the Student Affairs / Admin office',
    detail: 'Bring your student ID card or registration number so your identity can be confirmed.',
  },
  faculty: {
    who: 'the Admin office',
    detail: 'Your employee code will be needed to confirm your identity.',
  },
  parent: {
    who: 'the Admin office',
    detail: "Have your registered phone number and your child's registration number ready.",
  },
  admin: {
    who: 'a Super Admin',
    detail: 'Administrator accounts can only be reset by a Super Admin.',
  },
};

export default function ForgotPassword() {
  useViewportLock();

  const navigate = useNavigate();
  const location = useLocation();
  const roleParam = new URLSearchParams(location.search).get('role');

  const [role, setRole] = useState(
    PORTAL_ORDER.includes(roleParam) ? roleParam : 'student',
  );

  const portal = PORTALS[role];
  const contact = CONTACT[role];

  return (
    <div className="aims-auth">
      <div
        className="auth-field auth-field--locked"
        style={{ '--aura': portal.aura, alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}
      >
        <div
          className="rise"
          style={{
            width: '100%',
            maxWidth: '480px',
            padding: 'clamp(24px, 4vw, 36px)',
            background: 'var(--surface-container-lowest)',
            border: '1px solid var(--outline-variant)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--lift-1)',
          }}
        >
          <button type="button" className="btn btn--quiet" style={{ marginLeft: '-8px' }} onClick={() => navigate(-1)}>
            <ArrowLeft size={15} weight="bold" /> Back
          </button>

          <div
            style={{
              width: '48px',
              height: '48px',
              display: 'grid',
              placeItems: 'center',
              borderRadius: 'var(--r-md)',
              background: 'var(--primary-fixed)',
              color: 'var(--primary)',
              margin: '16px 0 20px',
            }}
          >
            <Key size={24} weight="duotone" />
          </div>

          <h1 className="t-h1 balance">Recover your access</h1>
          <p className="t-body ink-2 pretty" style={{ marginTop: '10px' }}>
            AIMS does not send reset links by email. Your password is reset in person by
            the office, so that your identity is verified before access is restored.
          </p>

          <div style={{ marginTop: '28px' }}>
            <p className="fld__label" style={{ marginBottom: '8px' }}>Which portal is your account for?</p>
            <div className="seg">
              {PORTAL_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="seg__item"
                  aria-pressed={role === key}
                  onClick={() => setRole(key)}
                >
                  {PORTALS[key].short}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: '20px',
              padding: '20px',
              borderRadius: 'var(--r-lg)',
              background: 'var(--surface-container-low)',
              border: '1px solid var(--outline-variant)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <p className="t-eyebrow">{portal.label}</p>
            </div>
            <p className="t-body-lg pretty" style={{ marginTop: '10px', fontWeight: 500 }}>
              Contact {contact.who} to have your password reset.
            </p>
            <p className="t-body ink-2 pretty" style={{ marginTop: '8px' }}>{contact.detail}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
              <span className="t-body ink-2" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <MapPin size={16} weight="fill" className="ink-4" aria-hidden="true" />
                Visit the admin office during working hours
              </span>
              <span className="t-body ink-2" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <Phone size={16} weight="fill" className="ink-4" aria-hidden="true" />
                Or call the office on the number printed on your ID card
              </span>
            </div>
          </div>

          <p className="t-body-sm ink-3 pretty" style={{ margin: '16px 0 24px', lineHeight: '18px' }}>
            If you can still sign in and simply want a new password, open{' '}
            <strong style={{ color: 'var(--on-surface-variant)' }}>Profile → Change password</strong> instead.
          </p>

          <button type="button" className="btn btn--primary btn--block" onClick={() => navigate(`/sign-in/${role}`)}>
            Back to sign in
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '24px',
              color: 'var(--on-surface-faint)',
            }}
          >
            <GraduationCap size={15} weight="fill" aria-hidden="true" />
            <span className="t-body-sm">AIIMS · Institute Management System</span>
          </div>
        </div>
      </div>
    </div>
  );
}
