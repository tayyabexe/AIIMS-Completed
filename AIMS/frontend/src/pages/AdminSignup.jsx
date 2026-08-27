import { useEffect, useRef, useState } from 'react';
import {
  Shield, GraduationCap, Mail, Lock, Eye, EyeOff, User,
  CheckCircle2, ArrowLeft, Bot, BarChart2, UserPlus,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const ACCENT = '#991b1b';
const GLOW = '#991b1b';

const FEATURES = [
  { icon: GraduationCap, text: '12,000+ students managed' },
  { icon: Bot, text: 'AI-powered risk prediction' },
  { icon: BarChart2, text: 'Real-time analytics & reports' },
  { icon: Shield, text: 'RBAC security & audit logs' },
];

const inputStyle = {
  width: '100%',
  padding: '0.8rem 2.6rem 0.8rem 2.6rem',
  borderRadius: '12px',
  border: '1px solid #CBD5E1',
  fontSize: '0.95rem',
  outline: 'none',
  backgroundColor: '#FFFFFF',
  transition: 'all 0.2s',
  fontFamily: "'Inter', sans-serif",
  boxSizing: 'border-box',
};

export default function AdminSignup() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agree, setAgree] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const timerRef = useRef(null);

  // Clear the redirect timer if the user leaves the page before it fires
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const focusAccent = (e) => {
    e.currentTarget.style.borderColor = ACCENT;
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.1)';
  };
  const blurDefault = (e) => {
    e.currentTarget.style.borderColor = '#CBD5E1';
    e.currentTarget.style.boxShadow = 'none';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (success) return;

    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!agree) {
      setError('Please accept the Terms of Service and Privacy Policy.');
      return;
    }

    setError('');
    setSuccess(true);
    // Demo front-end — swap for a real register API call when a backend exists.
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => navigate('/sign-in/admin'), 1800);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap', backgroundColor: '#F8FAFC' }}>
      {/* Left Dark Panel (mirrors the admin sign-in screen) */}
      <div style={{
        flex: '1 1 500px',
        backgroundColor: '#0B132B',
        color: 'white',
        padding: '3.5rem 3.5rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: '-15%',
          left: '-15%',
          width: '400px',
          height: '400px',
          backgroundColor: GLOW,
          opacity: 0.12,
          filter: 'blur(100px)',
          borderRadius: '50%',
        }} />

        <div style={{ position: 'relative', zIndex: 2 }}>
          {/* Logo header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '3rem' }}>
            <div
              onClick={() => navigate('/choose-portal')}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
              title="Back to Portal Selection"
            >
              <div style={{
                width: '42px',
                height: '42px',
                backgroundColor: '#991b1b',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(220,38,38,0.4)',
              }}>
                <GraduationCap size={24} color="white" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em', margin: 0 }}>AIIMS</h1>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 500 }}>Admin Portal</span>
              </div>
            </div>
          </div>

          {/* Secure tag */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'rgba(220, 38, 38, 0.15)',
            border: '1px solid rgba(220, 38, 38, 0.35)',
            borderRadius: '9999px',
            padding: '0.4rem 1rem',
            fontSize: '0.8rem',
            color: '#FCA5A5',
            fontWeight: 600,
            marginBottom: '1.75rem',
          }}>
            <Shield size={15} /> Secure &amp; Encrypted Registration
          </div>

          {/* Headline */}
          <h2 style={{
            fontSize: '2.5rem',
            fontWeight: 900,
            lineHeight: 1.2,
            letterSpacing: '-0.03em',
            marginBottom: '1.25rem',
            maxWidth: '480px',
            fontFamily: "'Outfit', sans-serif",
          }}>
            Manage your institute<br />with the power of AI
          </h2>

          <p style={{
            fontSize: '1rem',
            color: '#94A3B8',
            lineHeight: 1.65,
            marginBottom: '2.5rem',
            maxWidth: '480px',
            fontWeight: 400,
          }}>
            Access real-time analytics, student performance insights, automated
            attendance tracking, and intelligent fee management — all from one
            unified dashboard.
          </p>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            {FEATURES.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.95rem', color: '#E2E8F0', fontWeight: 500 }}>
                  <Icon size={20} color={GLOW} />
                  <span>{feat.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* User card footer */}
        <div style={{
          marginTop: '3.5rem',
          backgroundColor: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '16px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            backgroundColor: ACCENT,
            color: 'white',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.95rem',
          }}>
            SA
          </div>
          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'white', margin: 0 }}>Super Administrator</h4>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Full system access · Available upon registration</span>
          </div>
        </div>
      </div>

      {/* Right Form Panel */}
      <div style={{
        flex: '1 1 500px',
        padding: '3.5rem 3rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        <div style={{ width: '100%', maxWidth: '440px' }}>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{
              fontSize: '2rem',
              fontWeight: 900,
              color: '#0F172A',
              letterSpacing: '-0.02em',
              fontFamily: "'Outfit', sans-serif",
              margin: 0,
            }}>
              Create an account
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#64748B', marginTop: '4px', fontWeight: 500 }}>
              Sign up as a new administrator
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {/* Full Name */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  autoComplete="name"
                  style={inputStyle}
                  onFocus={focusAccent}
                  onBlur={blurDefault}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@aiims.edu"
                  autoComplete="email"
                  style={inputStyle}
                  onFocus={focusAccent}
                  onBlur={blurDefault}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  style={inputStyle}
                  onFocus={focusAccent}
                  onBlur={blurDefault}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 0 }}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                Confirm Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                  style={inputStyle}
                  onFocus={focusAccent}
                  onBlur={blurDefault}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 0 }}
                  aria-label="Toggle confirm password visibility"
                >
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Terms */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <input
                type="checkbox"
                id="agree"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                style={{ accentColor: ACCENT, width: '16px', height: '16px', cursor: 'pointer', marginTop: '2px' }}
              />
              <label htmlFor="agree" style={{ fontSize: '0.85rem', color: '#475569', cursor: 'pointer', fontWeight: 500, lineHeight: 1.5 }}>
                I agree to the{' '}
                <a href="#" onClick={(e) => e.preventDefault()} style={{ color: ACCENT, fontWeight: 700, textDecoration: 'none' }}>Terms of Service</a> and{' '}
                <a href="#" onClick={(e) => e.preventDefault()} style={{ color: ACCENT, fontWeight: 700, textDecoration: 'none' }}>Privacy Policy</a>
              </label>
            </div>

            {/* Error / success messages */}
            {error && (
              <div role="alert" style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5',
                borderRadius: '12px', padding: '0.8rem 1rem',
                fontSize: '0.85rem', color: '#7F1D1D', fontWeight: 600,
              }}>
                <Shield size={15} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}
            {success && (
              <div role="alert" style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                backgroundColor: '#ECFDF5', border: '1px solid #6EE7B7',
                borderRadius: '12px', padding: '0.8rem 1rem',
                fontSize: '0.85rem', color: '#065F46', fontWeight: 600,
              }}>
                <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> Account created successfully — redirecting to Sign In...
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.9rem',
                fontSize: '1rem',
                marginTop: '0.25rem',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: ACCENT,
                color: 'white',
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: `0 4px 15px ${GLOW}4D`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#7f1d1d';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 8px 25px ${GLOW}66`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = ACCENT;
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 4px 15px ${GLOW}4D`;
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.97) translateY(-1px)';
                e.currentTarget.style.opacity = '0.85';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.opacity = '1';
              }}
            >
              <UserPlus size={17} /> Create Account
            </button>

            {/* Already have an account */}
            <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.875rem', color: '#64748B' }}>
              Already have an account?{' '}
              <Link to="/sign-in/admin" style={{ color: ACCENT, fontWeight: 700, textDecoration: 'none' }}>
                Sign In
              </Link>
            </div>

            {/* Back to portal selection */}
            <button
              type="button"
              onClick={() => navigate('/choose-portal')}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748B',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: '0.25rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              <ArrowLeft size={16} /> Back to Portal Selection
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
