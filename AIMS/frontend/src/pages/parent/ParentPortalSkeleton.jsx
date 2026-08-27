import {
  SkeletonRegion, Skeleton, SkeletonStatRow, SkeletonTable,
  SkeletonList, SkeletonChart, SkeletonTimetable, SkeletonHero, SkeletonCardGrid,
} from '../../components/common/Skeleton';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  The parent portal, while it is loading
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS REPLACES
 * ------------------
 * `if (parentLoading) return <spinner />` — a grey ring and the sentence
 * "Loading your children's records…" centred on a blank white page. The whole
 * portal disappeared: sidebar, header, the tab you were on, all of it. Then it
 * all came back at once.
 *
 * That is worse here than on the other three portals, because the parent portal
 * is ONE route with its modules in component state. Switching tab while data is
 * refreshing did not navigate anywhere, so the parent watched the entire
 * application vanish and return in place — which reads as a crash, not as a
 * load.
 *
 * WHAT IT DOES INSTEAD
 * --------------------
 * The chrome stays. The navy sidebar and the header are drawn at full size with
 * placeholder contents, so the portal is visibly still there, and only the
 * content area fills in. And the content skeleton is chosen by the tab being
 * opened — a timetable gets a week grid, results get a table, notifications get
 * a list — so what appears is the shape of what is coming rather than a generic
 * grey page.
 *
 * The sidebar is drawn in the same navy as the real one on purpose. A greyed
 * sidebar would say "disabled"; this says "loading", which is the truth.
 */

const NAVY = '#0B132B';

/** The content placeholder for each of the seven modules. */
function TabBody({ tab }) {
  switch (tab) {

    case 'attendance':
      return (
        <>
          <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
          <SkeletonChart height={210} bars={12} style={{ marginBottom: '1.25rem' }} />
          <SkeletonTable rows={7} cols={5} />
        </>
      );

    case 'results':
      return (
        <>
          <SkeletonHero chips={3} style={{ marginBottom: '1.25rem' }} />
          <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
          <SkeletonTable rows={8} cols={6} />
        </>
      );

    case 'fees':
      return (
        <>
          <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
          <SkeletonList rows={5} avatar={false} />
        </>
      );

    case 'timetable':
      return (
        <>
          <SkeletonStatRow count={3} style={{ marginBottom: '1.25rem' }} />
          <SkeletonTimetable days={6} slots={5} />
        </>
      );

    case 'notifications':
      // Two columns, matching the real screen: the feed on the left, the
      // overview / wards / contacts stack on the right.
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem', alignItems: 'start' }}>
          <SkeletonList rows={5} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <SkeletonCardGrid count={1} minWidth={280} lines={2} />
            <SkeletonCardGrid count={1} minWidth={280} lines={4} />
          </div>
        </div>
      );

    case 'profile':
      return (
        <>
          <SkeletonHero chips={2} style={{ marginBottom: '1.25rem' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
            <SkeletonCardGrid count={2} minWidth={320} lines={4} />
            <SkeletonCardGrid count={2} minWidth={280} lines={3} />
          </div>
        </>
      );

    case 'dashboard':
    default:
      return (
        <>
          <SkeletonHero chips={1} height={96} style={{ marginBottom: '1.25rem' }} />
          <SkeletonStatRow count={4} style={{ marginBottom: '1.25rem' }} />
          <SkeletonCardGrid count={2} minWidth={380} lines={3} style={{ marginBottom: '1.25rem' }} />
          <SkeletonTable rows={5} cols={6} />
        </>
      );
  }
}

/**
 * @param {string} tab  the module being opened, so the placeholder matches it
 */
export default function ParentPortalSkeleton({ tab = 'dashboard' }) {
  return (
    <SkeletonRegion
      label="Loading your children's records"
      style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', display: 'block' }}
    >
      <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>

        {/* Sidebar — real width, real colour, placeholder contents. */}
        <aside style={{
          width: '260px', flexShrink: 0, backgroundColor: NAVY,
          display: 'flex', flexDirection: 'column', padding: '1.25rem 1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 0.25rem 1.25rem' }}>
            <Skeleton variant="card" w={34} h={34} radius="10px" style={{ opacity: 0.28 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Skeleton variant="text" w="70%" style={{ opacity: 0.28 }} />
              <Skeleton variant="text" w="45%" h={8} style={{ opacity: 0.2 }} />
            </div>
          </div>

          <div style={{ textAlign: 'center', padding: '1.1rem 0', borderTop: '1px solid #1E293B', borderBottom: '1px solid #1E293B' }}>
            <Skeleton variant="circle" w={56} h={56} style={{ margin: '0 auto 0.7rem', opacity: 0.3 }} />
            <Skeleton variant="text" w="55%" style={{ margin: '0 auto 6px', opacity: 0.28 }} />
            <Skeleton variant="text" w="70%" h={8} style={{ margin: '0 auto', opacity: 0.2 }} />
          </div>

          <div className="aims-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', paddingTop: '1.1rem' }}>
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0.55rem 0.5rem' }}>
                <Skeleton variant="card" w={20} h={20} radius="6px" style={{ opacity: 0.26 }} />
                <Skeleton variant="text" w={`${44 + ((i * 17) % 34)}%`} style={{ opacity: 0.26 }} />
              </div>
            ))}
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Header — search bar, bell, profile chip. */}
          <header style={{
            display: 'flex', alignItems: 'center', gap: '1rem',
            padding: '0.9rem 2rem', backgroundColor: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
          }}>
            <Skeleton variant="card" w={28} h={28} radius="8px" />
            <Skeleton variant="title" w={150} />
            <Skeleton variant="card" h={40} radius="12px" style={{ flex: 1, maxWidth: '520px', margin: '0 auto' }} />
            <Skeleton variant="circle" w={34} h={34} />
            <Skeleton variant="card" w={150} h={44} radius="14px" />
          </header>

          <main style={{ flex: 1, padding: '1.5rem 2rem' }}>
            <TabBody tab={tab} />
          </main>
        </div>
      </div>
    </SkeletonRegion>
  );
}
