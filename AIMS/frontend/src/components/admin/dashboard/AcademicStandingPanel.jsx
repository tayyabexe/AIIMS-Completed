import { Panel, Meter, LegendRow, DIVIDER } from './Panel';
import { TYPE, TONE, INK, ACTIVITY_TONE, SPACE } from '../../../styles/adminTheme';

/*
 * Academic standing, over the students who have a published result.
 *
 * THE DENOMINATOR IS THE WHOLE POINT
 * ----------------------------------
 * Every figure here is a share of `withResult`, not of the roll. Counting a
 * student with no result yet as a failure is what made an earlier version of
 * this dashboard report a 0% pass rate for the entire institute, and the
 * temptation to do it again is exactly why the coverage line at the bottom
 * says out loud how many students the panel is actually describing.
 *
 * `averageCgpa` and `distinction` were already in the response and already
 * being discarded. They belong together: a pass rate says how many cleared the
 * bar, the mean says where the middle of the cohort sits, and the distinction
 * count says whether there is a top end. One of those on its own is a
 * misleading summary of a cohort.
 */
export default function AcademicStandingPanel({ academics, totalStudents, index = 0 }) {
  const withResult = Number(academics.withResult || 0);
  const passed = Number(academics.passed || 0);
  const distinction = Number(academics.distinction || 0);
  const below = Math.max(withResult - passed, 0);

  // Distinction is a subset of passed (CGPA ≥ 3.5 implies ≥ 2.5), so the bar
  // segments it out of the passed share rather than adding it alongside —
  // otherwise the bar would total more than the cohort it describes.
  const passedOnly = Math.max(passed - distinction, 0);

  const cgpa = academics.averageCgpa == null ? '—' : Number(academics.averageCgpa).toFixed(2);

  return (
    <Panel
      title="Academic standing"
      hint="Latest published result per student"
      to="/examination"
      linkLabel="Examinations"
      index={index}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.sm }}>
        <p style={TYPE.figureSm}>{cgpa}</p>
        <p style={TYPE.meta}>mean CGPA</p>
      </div>

      <Meter
        total={withResult}
        ariaLabel={
          withResult > 0
            ? `${distinction.toLocaleString()} at distinction, ${passedOnly.toLocaleString()} passed, ${below.toLocaleString()} below the pass mark, of ${withResult.toLocaleString()} published results`
            : 'No results have been published yet'
        }
        segments={[
          { label: 'Distinction', value: distinction, color: ACTIVITY_TONE.result },
          { label: 'Passed', value: passedOnly, color: TONE.positive },
          { label: 'Below pass mark', value: below, color: TONE.critical },
        ]}
      />

      <div>
        <LegendRow
          color={ACTIVITY_TONE.result} label="Distinction (CGPA ≥ 3.5)"
          value={distinction.toLocaleString()}
        />
        <LegendRow
          color={TONE.positive} label="Passed (CGPA ≥ 2.5)"
          value={passed.toLocaleString()}
        />
        <LegendRow
          color={TONE.critical} label="Below the pass mark"
          value={below.toLocaleString()}
        />
      </div>

      <hr style={DIVIDER} />

      {/* Says how much of the institute this panel speaks for. Without it,
          every figure above silently claims to describe all 2,013 students. */}
      <p style={{ ...TYPE.micro, textWrap: 'pretty' }}>
        {withResult > 0
          ? `Based on ${withResult.toLocaleString()} of ${totalStudents.toLocaleString()} students — the rest have no published result yet.`
          : 'No results have been published, so there is nothing to report here yet.'}
      </p>
    </Panel>
  );
}
