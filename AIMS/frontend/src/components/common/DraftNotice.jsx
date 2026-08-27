/*
 * The shared status strip for a form backed by useDraft().
 *
 * It answers the two questions someone typing into a long form actually has:
 * is my work safe if this machine dies, and where did the text that is already
 * in these fields come from? A silent restore is worse than no restore — the
 * form appears to have invented content — so a restored draft always says so
 * and always offers a way out.
 */

import { CloudOff, Check, Loader2, RotateCcw, X } from 'lucide-react';

const relativeTime = (iso) => {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString();
};

export default function DraftNotice({ draft, online = true, onDiscard, compact = false }) {
  if (!draft) return null;

  const { status, savedAt, hasDraft, restoredDraft } = draft;

  const discard = () => {
    draft.clear();
    if (onDiscard) onDiscard();
  };

  const base = {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    fontSize: compact ? '0.75rem' : '0.8rem',
    padding: compact ? '0.35rem 0.6rem' : '0.55rem 0.85rem',
    borderRadius: '8px', flexWrap: 'wrap',
  };

  // Offline is the loudest state: it changes what the person should expect to
  // happen when they press Save.
  if (!online) {
    return (
      <div style={{ ...base, backgroundColor: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
        <CloudOff size={14} />
        <span>
          <strong>You are offline.</strong> Your work is being kept on this device
          {savedAt ? ` (saved ${relativeTime(savedAt)})` : ''} — reconnect before saving.
        </span>
      </div>
    );
  }

  if (hasDraft && restoredDraft) {
    return (
      <div style={{ ...base, backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF' }}>
        <RotateCcw size={14} />
        <span>
          Restored unsaved work from {relativeTime(restoredDraft.savedAt)}.
        </span>
        <button
          type="button"
          onClick={discard}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px',
            background: 'none', border: '1px solid #BFDBFE', borderRadius: '6px',
            color: '#1E40AF', cursor: 'pointer', padding: '2px 8px',
            fontSize: '0.72rem', fontWeight: 600,
          }}
        >
          <X size={12} /> Discard draft
        </button>
      </div>
    );
  }

  if (status === 'saving') {
    return (
      <div style={{ ...base, color: '#64748B' }}>
        <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
        <span>Saving draft…</span>
      </div>
    );
  }

  if (status === 'saved' && savedAt) {
    return (
      <div style={{ ...base, color: '#059669' }}>
        <Check size={13} />
        <span>Draft saved on this device · {relativeTime(savedAt)}</span>
      </div>
    );
  }

  return null;
}
