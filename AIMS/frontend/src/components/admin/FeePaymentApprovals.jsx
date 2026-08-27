import { useState } from 'react';
import {
  ShieldCheck, Check, X, Clock, AlertCircle, CheckCircle, Loader2, Inbox,
} from 'lucide-react';
import { feePayments as paymentsApi } from '../../api/endpoints';
import { useAdminPage, useListParams } from '../../hooks/useAdminPage';
import { formatMoney } from '../../utils/currency';
import Pagination from '../common/Pagination';

/*
 * The accounts office's approvals queue.
 *
 * WHY IT EXISTS
 * -------------
 * A parent can declare a payment from their own portal. That writes a
 * fee_payments row with status Pending and deliberately does NOT move the
 * balance — otherwise anyone could settle a voucher by typing a number into a
 * form. Verification is what applies it.
 *
 * The verify endpoint existed; nothing in the admin portal ever listed the rows
 * it acts on. So a declared payment landed in the database, showed the parent
 * "awaiting verification", and waited there permanently because no member of
 * staff had a screen on which it appeared. This is that screen.
 *
 * WHAT A DECISION DOES
 * --------------------
 * Verifying issues the receipt number and re-settles the voucher in the same
 * transaction, so the instalment and the balance accounting for it can never
 * exist apart. Rejecting leaves the row in place with status Rejected — a
 * refused claim is part of the trail, and deleting it would hide that the
 * parent ever made it. Both are written to the audit log against the admin who
 * decided.
 */

const TABS = [
  { key: 'Pending', label: 'Awaiting decision', icon: Clock },
  { key: 'Verified', label: 'Verified', icon: Check },
  { key: 'Rejected', label: 'Rejected', icon: X },
];

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function FeePaymentApprovals({ onDecided }) {
  const { params, filters, setFilter, setPage } = useListParams({
    status: 'Pending',
    limit: 10,
  });

  const { data, loading, error, refresh } = useAdminPage(
    (p) => paymentsApi.submitted(p),
    params, { key: 'payments-submitted' });

  const rows = data?.rows ?? [];
  const pagination = data?.pagination ?? { page: 1, pages: 1, total: 0, limit: 10 };

  // Which row is mid-decision, so its two buttons disable together and a
  // double-click cannot send two verifications for one payment.
  const [deciding, setDeciding] = useState(null);
  const [banner, setBanner] = useState(null);

  const flash = (tone, text) => {
    setBanner({ tone, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const decide = async (payment, status) => {
    setDeciding(payment.id);
    try {
      await paymentsApi.decide(payment.id, status);
      flash(
        'success',
        status === 'Verified'
          ? `${formatMoney(payment.amount)} verified against ${payment.voucher.number}.`
          : `Payment on ${payment.voucher.number} rejected.`,
      );
      refresh();
      // The roster, the totals and the collection chart on the parent screen
      // all move when a payment is verified, so they are refetched too.
      onDecided?.();
    } catch (err) {
      flash('error', err.message);
    } finally {
      setDeciding(null);
    }
  };

  const isPending = filters.status === 'Pending';

  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      borderRadius: '20px',
      border: '1px solid #E2E8F0',
      padding: '1.75rem',
      boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.25rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{
            fontSize: '1.2rem', fontWeight: 900, color: '#0F172A',
            letterSpacing: '-0.01em', margin: 0,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <ShieldCheck size={20} color="#DC2626" /> Payment Approvals
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '2px 0 0' }}>
            Payments parents and students have declared. Nothing here has moved a
            balance yet — verifying is what applies it.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.35rem', backgroundColor: '#F8FAFC', padding: '0.25rem', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter('status', key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '0.4rem 0.8rem', borderRadius: '8px', border: 'none',
                backgroundColor: filters.status === key ? '#FFFFFF' : 'transparent',
                boxShadow: filters.status === key ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                color: filters.status === key ? '#0F172A' : '#64748B',
                fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              <Icon size={13} /> {label}
              {key === filters.status && pagination.total > 0 && (
                <span style={{
                  backgroundColor: key === 'Pending' ? '#FEF3C7' : '#F1F5F9',
                  color: key === 'Pending' ? '#92400E' : '#475569',
                  borderRadius: '9999px', padding: '0 6px',
                  fontSize: '0.68rem', fontWeight: 800,
                }}>
                  {pagination.total}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div style={{
          padding: '0.7rem 1rem', borderRadius: '10px', fontSize: '0.85rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          backgroundColor: banner.tone === 'success' ? '#ECFDF5' : '#FEF2F2',
          border: `1px solid ${banner.tone === 'success' ? '#A7F3D0' : '#FECACA'}`,
          color: banner.tone === 'success' ? '#065F46' : '#991B1B',
        }}>
          {banner.tone === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {banner.text}
        </div>
      )}

      {error && (
        <div style={{
          padding: '0.8rem 1rem', borderRadius: '10px', backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.85rem',
        }}>
          Could not load the approvals queue: {error}
          <button
            onClick={refresh}
            style={{
              marginLeft: 8, border: '1px solid #FECACA', background: 'white',
              borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
              color: '#991B1B', fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* An empty queue is the healthy state and says so, rather than showing a
          bare table with no rows in it. */}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94A3B8' }}>
          <Inbox size={34} style={{ color: '#CBD5E1', marginBottom: '0.65rem' }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#64748B', margin: 0 }}>
            {isPending ? 'Nothing is waiting for a decision.' : `No ${filters.status.toLowerCase()} payments.`}
          </p>
          {isPending && (
            <p style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>
              Payments declared from the parent or student portal appear here.
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', position: 'relative' }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
            }}>
              <Loader2 size={22} className="approvals-spin" color="#991b1b" />
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#64748B', fontWeight: 700 }}>
                <th style={{ padding: '0.85rem 1rem' }}>Student</th>
                <th style={{ padding: '0.85rem 1rem' }}>Voucher</th>
                <th style={{ padding: '0.85rem 1rem' }}>Declared</th>
                <th style={{ padding: '0.85rem 1rem' }}>Method</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Amount</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Voucher balance</th>
                <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #F1F5F9', fontSize: '0.85rem' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <strong style={{ color: '#0F172A', display: 'block' }}>{p.student.name}</strong>
                    <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>{p.student.regNo}</span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <strong style={{ color: '#334155', display: 'block' }}>{p.voucher.number}</strong>
                    <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>
                      {p.voucher.semester || 'Unassigned semester'} · due {formatDate(p.voucher.dueDate)}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#64748B' }}>
                    <span style={{ display: 'block' }}>Paid {formatDate(p.paidOn)}</span>
                    {/* Who claimed it. Blank means it was entered at the
                        counter rather than declared through a portal. */}
                    <span style={{ color: '#94A3B8', fontSize: '0.72rem' }}>
                      {p.submittedBy?.email ? `by ${p.submittedBy.email}` : 'entered by staff'}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>{p.method}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>
                    {formatMoney(p.amount)}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', color: '#64748B' }}>
                    <span style={{ color: p.voucher.outstanding > 0 ? '#DC2626' : '#059669', fontWeight: 700 }}>
                      {formatMoney(p.voucher.outstanding)}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: '#94A3B8' }}>
                      of {formatMoney(p.voucher.billed)}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                    {p.status === 'Pending' ? (
                      <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => decide(p, 'Verified')}
                          disabled={deciding === p.id}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            backgroundColor: deciding === p.id ? '#CBD5E1' : '#059669',
                            color: 'white', border: 'none', borderRadius: '8px',
                            padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 700,
                            cursor: deciding === p.id ? 'wait' : 'pointer',
                          }}
                        >
                          <Check size={13} /> Verify
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(p, 'Rejected')}
                          disabled={deciding === p.id}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            backgroundColor: 'white', color: '#991B1B',
                            border: '1px solid #FECACA', borderRadius: '8px',
                            padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 700,
                            cursor: deciding === p.id ? 'wait' : 'pointer',
                          }}
                        >
                          <X size={13} /> Reject
                        </button>
                      </div>
                    ) : (
                      <span style={{
                        backgroundColor: p.status === 'Verified' ? '#D1FAE5' : '#FEE2E2',
                        color: p.status === 'Verified' ? '#065F46' : '#991B1B',
                        fontSize: '0.7rem', fontWeight: 800,
                        padding: '0.25rem 0.7rem', borderRadius: '9999px',
                      }}>
                        {p.status}
                        {p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          limit={pagination.limit}
          count={rows.length}
          onChange={setPage}
          noun="submission"
          loading={loading}
        />
      )}

      <style>{`
        .approvals-spin { animation: approvals-spin 1s linear infinite; }
        @keyframes approvals-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
