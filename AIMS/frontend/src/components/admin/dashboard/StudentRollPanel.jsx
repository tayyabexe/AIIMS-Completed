import { Panel, Meter, LegendRow, DIVIDER } from './Panel';
import { TYPE, TONE, INK, ACTIVITY_TONE, SPACE } from '../../../styles/adminTheme';

/*
 * The roll, broken down by standing.
 *
 * WHY THIS IS NOT ANOTHER TILE
 * ----------------------------
 * `active`, `pending` and `inactive` are shares of one total. Three more stat
 * tiles would print them as three unrelated numbers and leave the reader to do
 * the division; a single bar states the relationship the numbers already have.
 *
 * THE FOURTH SEGMENT
 * ------------------
 * The API counts `active`, `pending` (awaiting verification) and `inactive`
 * (suspended or withdrawn) — but `total` is every non-deleted student, and the
 * database's academic_status has values beyond those three, graduated among
 * them. So the three named counts do not have to add up to the total, and the
 * remainder is drawn as its own neutral segment rather than being folded into
 * one of the named ones or silently dropped. A bar that does not sum to its
 * own total is the kind of thing that quietly destroys trust in a dashboard.
 */
export default function StudentRollPanel({ students, index = 0 }) {
  const total = Number(students.total || 0);
  const active = Number(students.active || 0);
  const pending = Number(students.pending || 0);
  const inactive = Number(students.inactive || 0);
  const other = Math.max(total - active - pending - inactive, 0);

  const share = (n) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—');

  return (
    <Panel
      title="Student roll"
      hint={`Across ${students.programs.toLocaleString()} programme${students.programs === 1 ? '' : 's'}`}
      to="/students"
      linkLabel="Open"
      index={index}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.sm }}>
        <p style={TYPE.figureSm}>{share(active)}</p>
        <p style={TYPE.meta}>active</p>
      </div>

      <Meter
        total={total}
        ariaLabel={`${active.toLocaleString()} active, ${pending.toLocaleString()} awaiting verification, ${inactive.toLocaleString()} suspended or withdrawn, of ${total.toLocaleString()} students`}
        segments={[
          { label: 'Active', value: active, color: TONE.positive },
          { label: 'Awaiting verification', value: pending, color: TONE.warning },
          { label: 'Suspended or withdrawn', value: inactive, color: TONE.critical },
          { label: 'Other standing', value: other, color: ACTIVITY_TONE.audit },
        ]}
      />

      <div>
        <LegendRow
          color={TONE.positive} label="Active"
          value={active.toLocaleString()} note={share(active)}
        />
        <LegendRow
          color={TONE.warning} label="Awaiting verification"
          value={pending.toLocaleString()} note={share(pending)}
        />
        <LegendRow
          color={TONE.critical} label="Suspended or withdrawn"
          value={inactive.toLocaleString()} note={share(inactive)}
        />
        {other > 0 && (
          <LegendRow
            color={ACTIVITY_TONE.audit} label="Other standing"
            value={other.toLocaleString()} note={share(other)}
          />
        )}
      </div>

      <hr style={DIVIDER} />

      <p style={{ ...TYPE.micro, textWrap: 'pretty' }}>
        {pending > 0
          ? `${pending.toLocaleString()} record${pending === 1 ? '' : 's'} need verifying before ${pending === 1 ? 'it counts' : 'they count'} towards the active roll.`
          : 'Every record on the roll has been verified.'}
      </p>
    </Panel>
  );
}
