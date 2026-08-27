import { Panel, Meter, LegendRow, DIVIDER } from './Panel';
import { formatMoney } from '../../../utils/currency';
import { TYPE, TONE, INK, SPACE, SURFACE } from '../../../styles/adminTheme';

/*
 * Fee collection, as a position rather than a number.
 *
 * The KPI tile above says how much has been collected. That figure alone
 * cannot be judged: Rs 12.4M is excellent against Rs 13M billed and alarming
 * against Rs 40M. `billed` was already in the dashboard response and already
 * being discarded, so the panel that needed it cost nothing to feed.
 *
 * The hero here is therefore the RATE, not the amount — the amount is on the
 * tile above and does not need saying twice — and the bar underneath it splits
 * the billed total into what came in and what has not.
 */
export default function FeeCollectionPanel({ fees, totalStudents, index = 0 }) {
  const billed = Number(fees.billed || 0);
  const collected = Number(fees.collected || 0);
  const outstanding = Number(fees.outstanding || 0);

  // Nothing billed means no rate exists — shown as a dash, never as 0%, which
  // would read as "collected nothing" rather than "billed nothing".
  const rate = billed > 0 ? (collected / billed) * 100 : null;

  return (
    <Panel
      title="Fee collection"
      hint="Against everything billed this session"
      to="/fee-management"
      linkLabel="Manage"
      index={index}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.sm }}>
        <p style={TYPE.figureSm}>
          {rate == null ? '—' : `${rate.toFixed(1)}%`}
        </p>
        <p style={TYPE.meta}>collected</p>
      </div>

      <Meter
        total={billed}
        ariaLabel={
          rate == null
            ? 'Nothing has been billed yet'
            : `${rate.toFixed(1)} per cent of billed fees collected`
        }
        segments={[
          { label: 'Collected', value: collected, color: TONE.positive },
          { label: 'Outstanding', value: outstanding, color: TONE.warning },
        ]}
      />

      <div>
        <LegendRow color={TONE.positive} label="Collected" value={formatMoney(collected)} />
        <LegendRow color={TONE.warning} label="Outstanding" value={formatMoney(outstanding)} />
        <LegendRow color={SURFACE.inset} label="Billed" value={formatMoney(billed)} />
      </div>

      <hr style={DIVIDER} />

      {/* The money is one half of the question; how many people it is spread
          across is the other. An officer chasing payments works from the
          student counts, not from the total. */}
      <div style={{ display: 'flex', gap: SPACE.xl, flexWrap: 'wrap' }}>
        <Figure
          value={fees.studentsPaid.toLocaleString()}
          label={`of ${totalStudents.toLocaleString()} settled`}
        />
        <Figure
          value={fees.studentsOverdue.toLocaleString()}
          label="overdue"
          tone={fees.studentsOverdue > 0 ? TONE.critical : undefined}
        />
      </div>
    </Panel>
  );
}

/* A small paired figure — the number, then what it counts. */
function Figure({ value, label, tone }) {
  return (
    <div>
      <p style={{ ...TYPE.body, fontWeight: 650, color: tone || INK.primary, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p style={{ ...TYPE.micro, marginTop: '1px' }}>{label}</p>
    </div>
  );
}
