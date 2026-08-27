import { useState } from 'react';
import { KeyRound, Copy, Check, AlertTriangle, Printer, X } from 'lucide-react';
import useScrollLock from '../../hooks/useScrollLock';

/*
 * The one-time credentials popup.
 *
 * Shown immediately after an admin admits a student or onboards a teacher. It
 * is the only moment the generated passwords exist in readable form: the
 * database stores a bcrypt hash, so nothing can display them again afterwards.
 *
 * That single fact drives the whole design of this dialog:
 *
 *  - It says so, plainly and at the top. An admin who does not realise this is
 *    an admin who closes the box and creates a support ticket.
 *  - It cannot be dismissed by clicking the backdrop or pressing Escape. Every
 *    other modal in this portal can, and here that would destroy information.
 *    Closing requires ticking "I have saved these details".
 *  - Copy and Print are one click each, because the realistic thing an admin
 *    does next is paste them into an email or hand over a printout.
 *
 * When a parent was LINKED rather than created, no parent password is shown —
 * because none was issued. Their existing login still works, and saying
 * otherwise would send the admin looking for a password that does not exist.
 */

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the value is on screen to be read anyway */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: 'none', border: '1px solid #CBD5E1', borderRadius: '6px',
        padding: '2px 7px', cursor: 'pointer', fontSize: '0.7rem',
        fontWeight: 700, color: copied ? '#059669' : '#475569', flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Field({ label, value, mono }) {
  if (!value) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid #F1F5F9',
    }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
        <code style={{
          fontSize: '0.82rem', fontWeight: 700, color: '#0F172A',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          background: mono ? '#F8FAFC' : 'transparent',
          padding: mono ? '2px 6px' : 0, borderRadius: '4px',
        }}>
          {value}
        </code>
        <CopyButton value={value} label={label} />
      </span>
    </div>
  );
}

function AccountCard({ title, subtitle, account, tone }) {
  return (
    <div style={{
      border: `1px solid ${tone.border}`, borderRadius: '12px',
      backgroundColor: tone.bg, padding: '0.9rem 1rem',
    }}>
      <div style={{ marginBottom: '0.4rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: tone.text }}>
          {title}
        </h4>
        {subtitle && (
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#64748B' }}>
            {subtitle}
          </p>
        )}
      </div>
      {account.registrationNumber && (
        <Field label="Registration No." value={account.registrationNumber} mono />
      )}
      {account.employeeCode && <Field label="Employee Code" value={account.employeeCode} mono />}
      <Field label="Email" value={account.email} mono />
      <Field label="Password" value={account.password} mono />
    </div>
  );
}

export default function CredentialsDialog({ result, onClose }) {
  const [acknowledged, setAcknowledged] = useState(false);

  /*
   * Called before the early return below, because a hook cannot be skipped on
   * some renders — `!!result` is the open state, so the lock switches itself on
   * and off as this dialog appears and disappears.
   */
  useScrollLock(!!result);

  if (!result) return null;

  /*
   * `account` is the generic case: a password reissued from User Management,
   * where the holder may be a student, a parent, an employee — or nobody at
   * all, since twelve logins in this database have no person record. The three
   * specific keys describe a person being CREATED; this one describes a
   * credential being replaced on an account that already exists.
   */
  const { student, parent, teacher, account } = result;

  const everything = [
    student && `STUDENT\nName: ${student.name}\nRegistration No: ${student.registrationNumber}\nEmail: ${student.email}\nPassword: ${student.password}`,
    parent?.password && `PARENT\nName: ${parent.name}\nEmail: ${parent.email}\nPassword: ${parent.password}`,
    teacher && `TEACHER\nName: ${teacher.name}\nEmployee Code: ${teacher.employeeCode}\nEmail: ${teacher.email}\nPassword: ${teacher.password}`,
    account && `ACCOUNT\nName: ${account.name}\nEmail: ${account.email}\nPassword: ${account.password}`,
  ].filter(Boolean).join('\n\n');

  const print = () => {
    const w = window.open('', '_blank', 'width=600,height=700');
    if (!w) return;
    w.document.write(
      `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;padding:24px;white-space:pre-wrap">`
      + `AIIMS — Account Details\n${'='.repeat(40)}\n\n${everything}\n\n`
      + `${'='.repeat(40)}\nThe password must be changed on first sign-in.</pre>`
    );
    w.document.close();
    w.print();
  };

  return (
    <div
      // Deliberately no onClick-to-dismiss. Closing this by accident loses the
      // only copy of these passwords.
      //
      // Same reasoning behind the scroll lock above: this dialog holds a
      // credential that exists nowhere else, and a wheel gesture that scrolls
      // the page behind it is how someone loses their place while copying it
      // down.
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.7)',
        backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div style={{
        backgroundColor: 'white', borderRadius: '18px', width: '100%',
        maxWidth: '540px', maxHeight: '92vh', display: 'flex',
        flexDirection: 'column', boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.15rem 1.5rem', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '12px',
            backgroundColor: '#ECFDF5', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: '#059669',
          }}>
            <KeyRound size={20} />
          </div>
          <div>
            <h3 style={{
              fontSize: '1.1rem', fontWeight: 800, color: '#0F172A',
              margin: 0, fontFamily: "'Outfit', sans-serif",
            }}>
              Account created
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '2px 0 0' }}>
              Hand these over now — they cannot be shown again.
            </p>
          </div>
        </div>

        <div style={{
          padding: '1.1rem 1.5rem', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: '0.85rem',
        }}>
          {/* The warning that makes the rest of the dialog make sense. */}
          <div style={{
            display: 'flex', gap: '0.6rem', padding: '0.7rem 0.9rem',
            borderRadius: '10px', backgroundColor: '#FFFBEB',
            border: '1px solid #FDE68A', color: '#92400E', fontSize: '0.8rem',
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              <strong>This is the only time these passwords are shown.</strong> They
              are stored encrypted, so nobody — including you — can look them up
              later. If they are lost, issue a new password from the account's
              profile. Each user must set their own password on first sign-in.
            </span>
          </div>

          {/* A password reissued from User Management. */}
          {account && (
            <AccountCard
              title={account.name}
              subtitle="Their previous password stopped working the moment this was issued"
              account={account}
              tone={{ bg: '#F8FAFC', border: '#CBD5E1', text: '#334155' }}
            />
          )}

          {student && (
            <AccountCard
              title={`Student · ${student.name}`}
              account={student}
              tone={{ bg: '#EFF6FF', border: '#BFDBFE', text: '#1E40AF' }}
            />
          )}

          {teacher && (
            <AccountCard
              title={`Teacher · ${teacher.name}`}
              subtitle={teacher.assignmentCount
                ? `${teacher.assignmentCount} class${teacher.assignmentCount === 1 ? '' : 'es'} assigned`
                : 'No classes assigned yet'}
              account={teacher}
              tone={{ bg: '#F5F3FF', border: '#DDD6FE', text: '#5B21B6' }}
            />
          )}

          {/* A parent who already existed was linked, not created — so there is
              no new password, and the dialog says so rather than leaving the
              admin hunting for one. */}
          {parent && parent.created && (
            <AccountCard
              title={`Parent · ${parent.name}`}
              subtitle="Can now follow this student's attendance, results and fees"
              account={parent}
              tone={{ bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46' }}
            />
          )}

          {parent && !parent.created && (
            <div style={{
              padding: '0.7rem 0.9rem', borderRadius: '10px',
              backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
              fontSize: '0.8rem', color: '#475569',
            }}>
              <strong>{parent.name}</strong> ({parent.email}) already had a parent
              account, so this student was added to it. Their existing password
              still works — no new one was issued, and they will now see this
              child alongside their others.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem', borderTop: '1px solid #E2E8F0',
          backgroundColor: '#F8FAFC', borderRadius: '0 0 18px 18px',
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(everything)}
              style={{
                flex: 1, padding: '0.55rem', borderRadius: '8px',
                border: '1px solid #CBD5E1', background: 'white',
                color: '#334155', fontWeight: 700, fontSize: '0.82rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px',
              }}
            >
              <Copy size={14} /> Copy all
            </button>
            <button
              type="button"
              onClick={print}
              style={{
                flex: 1, padding: '0.55rem', borderRadius: '8px',
                border: '1px solid #CBD5E1', background: 'white',
                color: '#334155', fontWeight: 700, fontSize: '0.82rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px',
              }}
            >
              <Printer size={14} /> Print
            </button>
          </div>

          {/* The gate. Closing is only possible once this is ticked. */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            fontSize: '0.8rem', color: '#334155', cursor: 'pointer', fontWeight: 600,
          }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ width: '15px', height: '15px', cursor: 'pointer' }}
            />
            I have saved or handed over these details
          </label>

          <button
            type="button"
            onClick={onClose}
            disabled={!acknowledged}
            style={{
              padding: '0.6rem', borderRadius: '8px', border: 'none',
              backgroundColor: acknowledged ? '#991b1b' : '#CBD5E1',
              color: 'white', fontWeight: 700, fontSize: '0.87rem',
              cursor: acknowledged ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}
          >
            <X size={15} /> Close
          </button>
        </div>
      </div>
    </div>
  );
}
