import { useState } from 'react';
import {
  BadgeCheck, ChevronRight, Clock, CreditCard, GraduationCap,
  Camera, HeartHandshake, KeyRound, Lock, Mail, Phone, ShieldCheck, User, Users,
} from 'lucide-react';
import ChangePasswordDialog from '../../components/common/ChangePasswordDialog';
import AvatarUploader from '../../components/common/AvatarUploader';
import useAvatarActions from '../../hooks/useAvatarActions';
import useAuthedImage from '../../hooks/useAuthedImage';
import UserAvatar from '../../components/common/UserAvatar';

const RED = '#991b1b';
const NAVY = '#0B132B';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Deterministic derived fields so every parent sees stable, plausible data
function deriveMemberSince(parentId) {
  const year = 2020 + ((parentId * 3) % 4);
  const month = MONTHS[(parentId * 5) % 12];
  return `${month} ${year}`;
}

// Deterministic CNIC (Pakistani format: XXXXX-XXXXXXX-X)
function deriveCnic(parentId) {
  return `${String(35000 + parentId * 137).slice(0, 5)}-${String(2000000 + parentId * 54321).slice(0, 7)}-${(parentId * 7) % 10}`;
}

export default function ProfileView({ user, parentData, wards = [], onViewChild }) {
  /*
   * The parent portal had no way to change a password at all.
   *
   * The student portal has had one in its own Profile since it was built, and
   * the forced first change at /change-password covers only the first time.
   * Between those two a parent was stuck: once the admin-issued password was
   * replaced there was no route back to the form, which is half of why this
   * portal's accounts looked untouched in User Management.
   */
  const [pwOpen, setPwOpen] = useState(false);

  /*
   * The parent portal could not set a profile picture either.
   *
   * Same gap as the faculty portal: a parent saw their children's photographs
   * and had no way to add their own, so the account was permanently two grey
   * letters in the sidebar, the header and the admin's Parents screen.
   *
   * `photoVersion` is bumped after an upload. `useAuthedImage` keys off the
   * URL string, so without something changing in it the hook would not re-run
   * and this card would keep showing the previous portrait even though the
   * shared cache had already been cleared.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);

  const avatarUrl = useAuthedImage(
    user?.userId ? `/api/users/${user.userId}/avatar?v=${photoVersion}` : null,
  ).url;

  const { upload, remove } = useAvatarActions(user?.userId, {
    onDone: async () => setPhotoVersion((v) => v + 1),
  });

  const parentName = user?.name || parentData?.name || 'Parent';
  const parentEmail = parentData?.email || user?.email || '—';
  const parentPhone = parentData?.phone || '—';
  const parentId = parentData?.id || 0;

  const initials = parentName
    .replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s*/i, '')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'P';

  const isMother = /mrs\.|ms\./i.test(parentName);
  const relationship = isMother ? 'Mother' : 'Father';
  const memberSince = deriveMemberSince(parentId);
  const cnic = deriveCnic(parentId);
  const address = wards[0]?.address || 'H#12, St#7, Sector F-4, Islamabad';
  const guardianPhone = wards[0]?.guardianPhone || parentPhone;
  const guardianName = wards[0]?.guardianName || parentName;

  const cardStyle = {
    backgroundColor: '#FFFFFF', borderRadius: '20px', border: '1px solid #E2E8F0',
    boxShadow: '0 4px 20px rgba(0,0,0,0.03)', overflow: 'hidden',
  };

  const cardHeader = (icon, title, sub) => (
    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '38px', height: '38px', borderRadius: '11px', flexShrink: 0,
        backgroundColor: '#FEF2F2', color: RED,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
          {title}
        </h4>
        {sub && <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '2px 0 0' }}>{sub}</p>}
      </div>
    </div>
  );

  const infoRow = (label, value, valueColor = '#0F172A', strong = false) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem',
      padding: '0.8rem 1.5rem', borderBottom: '1px solid #F8FAFC',
    }}>
      <span style={{ fontSize: '0.8rem', color: '#94A3B8', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: '0.86rem', color: valueColor, fontWeight: strong ? 800 : 600,
        textAlign: 'right', fontFamily: strong ? "'Outfit', sans-serif" : "'Inter', sans-serif",
      }}>
        {value}
      </span>
    </div>
  );

  return (
    <div>
      {/* NAVY identity strip — name, phone & email card */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1B2A4A 100%)`,
        borderRadius: '20px', padding: '2rem', marginBottom: '1.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '1.5rem', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-70%', right: '6%',
          width: '340px', height: '340px', backgroundColor: '#FFFFFF', opacity: 0.05,
          filter: 'blur(70px)', borderRadius: '50%',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', position: 'relative', zIndex: 2 }}>
          {/* Avatar */}
          {/* The parent's own picture, and the control that changes it.
              `user.userId` is the users row their token was signed for, which
              is exactly what the avatar route is keyed by. */}
          <div className="avu-editable">
            <UserAvatar
              userId={user?.userId}
              version={photoVersion}
              name={parentName}
              initials={initials}
              size={72}
              ring="2px solid rgba(255,255,255,0.15)"
              style={{
                background: `linear-gradient(135deg, ${RED} 0%, #7f1d1d 100%)`,
                boxShadow: '0 8px 24px rgba(153,27,27,0.45)',
              }}
            />
            <button
              type="button"
              className="avu-edit-badge"
              onClick={() => setPickerOpen(true)}
              aria-label="Change your profile picture"
              title="Change picture"
            >
              <Camera size={14} />
            </button>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'white', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
                {parentName}
              </h2>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                fontSize: '0.7rem', fontWeight: 700, color: '#A7F3D0',
                backgroundColor: 'rgba(5,150,105,0.2)', border: '1px solid rgba(5,150,105,0.35)',
                padding: '3px 10px', borderRadius: '20px',
              }}>
                <BadgeCheck size={13} /> Verified Parent
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.4rem', marginTop: '0.6rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.88rem', color: '#CBD5E1' }}>
                <Phone size={15} color="#FCA5A5" /> {parentPhone}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.88rem', color: '#CBD5E1' }}>
                <Mail size={15} color="#FCA5A5" /> {parentEmail}
              </span>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'flex', gap: '0.75rem', position: 'relative', zIndex: 2, flexWrap: 'wrap' }}>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '14px', padding: '0.75rem 1.25rem', textAlign: 'center',
          }}>
            <p style={{ fontSize: '1.3rem', fontWeight: 900, color: 'white', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
              {wards.length}
            </p>
            <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '2px 0 0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Wards linked
            </p>
          </div>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '14px', padding: '0.75rem 1.25rem', textAlign: 'center',
          }}>
            <p style={{ fontSize: '1.3rem', fontWeight: 900, color: 'white', margin: 0, fontFamily: "'Outfit', sans-serif" }}>
              {memberSince.split(' ')[0].slice(0, 3)}
            </p>
            <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '2px 0 0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Since {memberSince.split(' ')[1]}
            </p>
          </div>
        </div>
      </div>

      {/* Card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        {/* ===== Left column ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Personal Information */}
          <div style={cardStyle}>
            {cardHeader(<User size={18} />, 'Personal Information', 'Details on file with the institute')}
            {infoRow('Full Name', parentName, '#0F172A', true)}
            {infoRow('Parent ID', `PRN-${String(parentId).padStart(3, '0')}`, RED, true)}
            {infoRow('CNIC', cnic, '#0F172A', true)}
            {infoRow('Member Since', memberSince)}
            <div style={{ padding: '0.9rem 1.5rem' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                borderRadius: '10px', padding: '0.6rem 0.9rem',
              }}>
                <ShieldCheck size={16} color="#059669" />
                <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                  Account status: <strong style={{ color: '#059669' }}>Active &amp; verified</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Security — the routine password change.

              Deliberately in the LEFT column beside the account's own details
              rather than tucked under the ward list: it acts on this parent's
              login, not on a child's record. */}
          <div style={cardStyle}>
            {cardHeader(<Lock size={18} />, 'Security', 'Your sign-in credentials')}
            {infoRow('Sign-in email', parentEmail, '#0F172A', true)}
            <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                  Password
                </p>
                <p style={{ fontSize: '0.74rem', color: '#64748B', margin: '2px 0 0', lineHeight: 1.5 }}>
                  Change it whenever you like. You will stay signed in here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPwOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '7px',
                  padding: '0.55rem 1.05rem', borderRadius: '10px', border: 'none',
                  backgroundColor: RED, color: 'white', fontSize: '0.8rem', fontWeight: 700,
                  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                  transition: 'background-color 0.2s, transform 0.1s, box-shadow 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#7f1d1d';
                  e.currentTarget.style.boxShadow = '0 6px 18px rgba(153,27,27,0.28)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = RED;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <KeyRound size={15} /> Change password
              </button>
            </div>
          </div>

          {/* Contact Information */}
          <div style={cardStyle}>
            {cardHeader(<Mail size={18} />, 'Contact Information', 'Primary and alternate contact details')}
            {infoRow('Phone', parentPhone, '#0F172A', true)}
            {infoRow('Email', parentEmail, '#0F172A', true)}
            {infoRow('Residential Address', address, '#475569')}
            <div style={{ padding: '0.9rem 1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="#94A3B8" />
              <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                Preferred contact hours: <strong>Mon–Sat, 9:00 AM – 6:00 PM</strong>
              </span>
            </div>
          </div>
        </div>

        {/* ===== Right column ===== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Guardian Information */}
          <div style={cardStyle}>
            {cardHeader(<HeartHandshake size={18} />, 'Guardian Information', 'Who the institute can reach')}
            {infoRow('Guardian Name', guardianName, '#0F172A', true)}
            {infoRow('Relationship', relationship)}
            {infoRow('Guardian Phone', guardianPhone, '#0F172A', true)}
            {infoRow('Linked Wards', `${wards.length} enrolled`, RED, true)}
            <div style={{ padding: '0.9rem 1.5rem' }}>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: '10px', padding: '0.65rem 0.9rem',
              }}>
                <Users size={15} color={RED} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '0.76rem', color: '#7f1d1d', fontWeight: 600, lineHeight: 1.5 }}>
                  Please keep your contact details up to date so we can reach you in case of an emergency.
                </span>
              </div>
            </div>
          </div>

          {/* Linked Students */}
          <div style={cardStyle}>
            {cardHeader(<GraduationCap size={18} />, 'Linked Students', 'Your registered wards')}
            <div style={{ padding: '0.6rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {wards.map((child) => (
                <div
                  key={child.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '0.8rem 0.85rem', borderRadius: '14px',
                    backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                    transition: 'all 0.2s', cursor: 'pointer',
                  }}
                  onClick={() => onViewChild && onViewChild(child.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#FEF2F2';
                    e.currentTarget.style.borderColor = '#FCA5A5';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#F8FAFC';
                    e.currentTarget.style.borderColor = '#E2E8F0';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <UserAvatar
                    userId={child.userId}
                    hasPhoto={child.hasPhoto}
                    version={child.avatarVersion}
                    name={child.name}
                    initials={child.initials}
                    bg={child.avatarBg || RED}
                    size={40}
                    shape="rounded"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {child.name}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '2px 0 0' }}>
                      {child.program} · {child.semester}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{
                      display: 'inline-block', fontSize: '0.68rem', fontWeight: 800,
                      color: (child.cgpa || 0) >= 3.5 ? '#059669' : (child.cgpa || 0) >= 2.5 ? '#0F172A' : '#DC2626',
                      backgroundColor: (child.cgpa || 0) >= 3.5 ? '#ECFDF5' : (child.cgpa || 0) >= 2.5 ? '#F1F5F9' : '#FEE2E2',
                      padding: '2px 9px', borderRadius: '20px',
                    }}>
                      CGPA {child.cgpa?.toFixed(2)}
                    </span>
                  </div>
                  <ChevronRight size={16} color="#CBD5E1" style={{ flexShrink: 0 }} />
                </div>
              ))}

              {wards.length === 0 && (
                <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                  <Users size={36} color="#CBD5E1" />
                  <p style={{ fontSize: '0.85rem', color: '#94A3B8', margin: '0.5rem 0 0' }}>No wards linked yet</p>
                </div>
              )}

              {wards.length > 0 && (
                <button
                  onClick={() => wards[0] && onViewChild && onViewChild(wards[0].id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    marginTop: '0.25rem', padding: '0.6rem 1rem', borderRadius: '10px',
                    backgroundColor: NAVY, color: 'white', border: 'none',
                    fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.2s', fontFamily: "'Inter', sans-serif",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1B2A4A'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = NAVY; }}
                >
                  View ward dashboard <ChevronRight size={15} />
                </button>
              )}
            </div>
          </div>

          {/* Quick reference */}
          <div style={{
            ...cardStyle,
            background: 'linear-gradient(135deg, #FFF7F7 0%, #FFFFFF 100%)',
            padding: '1.1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '11px', flexShrink: 0,
              backgroundColor: '#EEF2FF', color: '#4F46E5',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CreditCard size={18} />
            </div>
            <div>
              <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                Keep your profile up to date
              </p>
              <p style={{ fontSize: '0.74rem', color: '#64748B', margin: '2px 0 0', lineHeight: 1.5 }}>
                Contact the academic office to update phone, address, or guardian details.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />

      <AvatarUploader
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentUrl={avatarUrl}
        name={parentName}
        onUpload={upload}
        onRemove={avatarUrl ? remove : undefined}
      />
    </div>
  );
}
