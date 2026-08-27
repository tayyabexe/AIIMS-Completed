import useScrollLock from '../../hooks/useScrollLock';
import { X } from 'lucide-react';

/*
 * The dialog shell the new admin screens use.
 *
 * WHY IT EXISTS
 * -------------
 * Every modal in this portal was hand-rolled: its own fixed overlay, its own
 * z-index, its own close button, its own decision about whether the backdrop
 * dismisses it. They drifted — some lock the page behind them, some did not, and
 * the ones that did not are the reason scrolling over an open form moved the
 * table underneath instead of the form.
 *
 * Wrapping it means useScrollLock cannot be forgotten: it is called here, so a
 * dialog built from this component is locked by construction rather than by
 * whoever remembered to add the hook.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not close on backdrop click unless `onBackdropClose` is passed. A
 * click-through dismiss on a form with typed values in it destroys work, and the
 * useDraft machinery elsewhere in this portal exists precisely because that kept
 * happening. Destructive confirmations opt in; forms do not.
 */
export default function Modal({
  open,
  title,
  icon: Icon,
  onClose,
  onBackdropClose,
  children,
  footer,
  width = '580px',
  tone = '#991b1b',
}) {
  // Called unconditionally — a hook cannot be skipped on some renders — with
  // `open` as its argument, so it switches itself on and off.
  useScrollLock(!!open);

  if (!open) return null;

  return (
    <div
      onClick={onBackdropClose ? (e) => { if (e.target === e.currentTarget) onBackdropClose(); } : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#FFFFFF', borderRadius: '16px',
          width: '100%', maxWidth: width, maxHeight: '90vh',
          // The dialog scrolls internally; the page behind it does not scroll at
          // all, which together is what stops a wheel gesture running off the
          // end of the form and into the table.
          overflowY: 'auto', border: '1px solid #E2E8F0',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
          padding: '1.75rem',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {Icon && <Icon size={20} color={tone} />}
            <h3 style={{
              fontSize: '1.15rem', fontWeight: 700, color: '#0F172A', margin: 0,
              fontFamily: 'Outfit, sans-serif',
            }}>
              {title}
            </h3>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px' }}
            >
              <X size={20} />
            </button>
          )}
        </div>

        {children}

        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
