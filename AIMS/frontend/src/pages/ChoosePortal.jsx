import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, House } from '@phosphor-icons/react';
import { PORTALS, PORTAL_ORDER } from '../lib/portals';
import { StageBackdrop, useViewportLock } from '../components/stage/Stage';
import '../styles/auth.css';
import '../styles/stage.css';

/**
 * The front door.
 *
 * Intent      Whoever opens AIMS before they are anyone in particular — a
 *             student at 07:50 on a phone, a parent at the kitchen table, the
 *             office at nine. One job: find your door and go through it.
 * Hierarchy   The four credential plates are the focal element. White plates on
 *             ink are the only things on the page with real contrast; the
 *             headline sets the frame and then gets out of the way.
 * Order       Student first, admin last. Sorted by who arrives here most often,
 *             not by rank.
 *
 * WHY IT NO LONGER SCROLLS
 * It never had anything below the fold. What it had was an ambient aura hanging
 * 260px past the bottom edge of a container that only clipped its x-axis, which
 * produced exactly 260px of document scroll into blank ink under the footer.
 * The aura is clipped on both axes now, and the page is locked to the viewport
 * so it cannot grow a scrollbar again — there is one question here, and the
 * answer to it is entirely on screen.
 *
 * The plates used to carry a portal code (AIMS·STU) and an academic-year chip.
 * Both were internal shorthand printed at a person who has not signed in yet
 * and cannot act on either, so both are gone; the space now holds the
 * go-affordance, which is the only thing this screen is actually asking for.
 */
export default function ChoosePortal() {
  const navigate = useNavigate();
  useViewportLock();

  /*
   * Which plate the pointer is over. It is fed to the backdrop so the ambient
   * aura shifts to that portal's hue as you consider it — the one thing on the
   * page that responds before you have committed to anything, and the reason
   * the background reads as attached to the choice rather than wallpapered
   * behind it. Nothing depends on it, so a device with no pointer simply gets
   * the resting blue.
   */
  const [over, setOver] = useState(null);
  const accent = over ? PORTALS[over].aura : undefined;
  const hue = over ? PORTALS[over].hueOnInk : undefined;

  return (
    <div className="aims-auth">
      <div className="auth-field auth-field--locked stage">
        <StageBackdrop accent={accent} hue={hue} />

        <header className="stage__bar">
          <button type="button" className="auth-mark" onClick={() => navigate('/')}>
            <span className="auth-mark__seal"><GraduationCap size={21} weight="fill" /></span>
            <span>
              <span className="auth-mark__name">AIIMS</span>
              <span className="auth-mark__sub">Institute Management</span>
            </span>
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => navigate('/')}>
            <House size={15} weight="bold" /> Home
          </button>
        </header>

        <main className="stage__main">
          <div className="pick">
            <div className="pick__say">
              <p className="t-eyebrow">Access</p>
              <h1 className="pick__head">Choose the portal your account belongs to</h1>
              <p className="pick__sub">
                Each portal issues its own credential. Signing in with an account from a
                different portal will not be accepted, so pick the one that matches your role.
              </p>
            </div>

            <div className="pick__grid" onMouseLeave={() => setOver(null)}>
              {PORTAL_ORDER.map((key, i) => {
                const portal = PORTALS[key];
                const Icon = portal.icon;
                return (
                  <button
                    key={portal.id}
                    type="button"
                    className="auth-plate rise"
                    onClick={() => navigate(`/sign-in/${portal.id}`)}
                    onMouseEnter={() => setOver(key)}
                    onFocus={() => setOver(key)}
                    style={{
                      '--hue': portal.hue,
                      '--hue-soft': portal.hueSoft,
                      '--delay': `${80 + i * 60}ms`,
                    }}
                  >
                    <span className="auth-plate__head">
                      <span className="auth-plate__chip"><Icon size={24} weight="duotone" /></span>
                      <span className="auth-plate__arrow"><ArrowRight size={15} weight="bold" /></span>
                    </span>

                    <span>
                      <span className="t-h3" style={{ display: 'block' }}>{portal.label}</span>
                      <span className="t-body auth-plate__desc pretty" style={{ display: 'block', marginTop: '6px' }}>
                        {portal.desc}
                      </span>
                    </span>

                    <span className="auth-plate__foot">
                      <span className="auth-plate__go">Sign in</span>
                      <span className="t-body-sm ink-4">{portal.holder}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>

        <footer className="stage__foot">
          <span className="t-body-sm">© AIIMS · Institute Management System</span>
          <span className="t-body-sm">
            Can&apos;t sign in?{' '}
            <button type="button" className="lnk" onClick={() => navigate('/forgot-password')}>
              Recover access
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
