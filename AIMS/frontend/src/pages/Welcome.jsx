import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowsOutCardinal,
  CalendarCheck,
  CaretDown,
  ChartLineUp,
  ChatCircleDots,
  Check,
  GraduationCap,
  Sparkle,
  SquaresFour,
} from '@phosphor-icons/react';
import { PORTALS, PORTAL_ORDER } from '../lib/portals';
import { StageBackdrop, useReel, usePreload } from '../components/stage/Stage';
import '../styles/auth.css';
import '../styles/stage.css';
import '../styles/home.css';

/**
 * The landing page.
 *
 * Four sections over one fixed stage: the ask, the product, who it is for, and
 * the claims. It scrolls — unlike the chooser and the sign-in screens, which
 * are locked to the viewport because each asks exactly one question and has
 * nothing below the fold. This page has something to say, and saying it needs
 * room. What does not scroll is the room itself: the clip, the aurora and the
 * ruled field are fixed, so the sections travel through a space that stays put.
 *
 * ONE CALL TO ACTION
 * There is a single portal button, in the hero. Once it scrolls out of view the
 * header adopts it, and gives it back when the hero returns — so exactly one is
 * on screen at any moment and never two. The old page had three, in the header,
 * the hero and a closing band, which is how a page teaches people that its
 * buttons do not matter.
 *
 * ON THE FRAMES AND THE CLIP
 * The reel frames are real screenshots of this build. They were captured
 * against a near-empty database, so the figures inside them are zeros — they
 * are here as evidence the modules exist, and the caption beside each one
 * carries the claim rather than the pixels. The background clip is generated
 * from those same screenshots and is atmosphere only: it is blurred and held
 * low precisely because its lettering is model-invented and must never resolve
 * into something a reader would try to read.
 */

const FRAMES = [
  {
    src: '/media/stage/01-cards.jpg',
    icon: SquaresFour,
    hue: '#7fd8c8',
    name: 'A dashboard that is yours',
    note: 'Every card can be moved, resized or taken off the screen. The arrangement is saved per person, so it opens the way you left it.',
  },
  {
    src: '/media/stage/02-arrange.jpg',
    icon: ArrowsOutCardinal,
    hue: '#b4c5ff',
    name: 'Arrange',
    note: 'Drag from the panel, drop onto the grid. A question you saved becomes a card that keeps answering itself.',
  },
  {
    src: '/media/stage/03-ask.jpg',
    icon: Sparkle,
    hue: '#ffc06b',
    name: 'Ask the data',
    note: 'A question in plain language becomes a database query. The rows come back as a table or a chart — never summarised, never rewritten by a language model.',
  },
  {
    src: '/media/stage/04-insights.jpg',
    icon: ChartLineUp,
    hue: '#8fb4ff',
    name: 'Insights',
    note: 'Attendance, results and fee movement read straight off the live record, with the query behind every number available to see.',
  },
  {
    src: '/media/stage/05-timetable.jpg',
    icon: CalendarCheck,
    hue: '#ffb1c4',
    name: 'Timetable',
    note: 'Sections, rooms and teaching hours resolve into one schedule that every portal reads from.',
  },
  {
    src: '/media/stage/06-assistant.jpg',
    icon: ChatCircleDots,
    hue: '#7fd8c8',
    name: 'Assistant',
    note: 'Answers drawn from your own institute — bounded by what the person asking is allowed to see.',
  },
];

const TERM = ['Admissions', 'Timetable', 'Attendance', 'Assessment', 'Results', 'Fees'];

/*
 * Supplied platform claims, not readings from this deployment — so they get
 * size, but no live dot, no ticking "now" and no health colour. A claim a
 * landing page makes is a different kind of statement from a number the
 * product measured, and the styling has to keep them different.
 */
const FIGURES = [
  ['500+', 'Institutions'],
  ['2.4M+', 'Students'],
  ['99.9%', 'Uptime'],
  ['140+', 'Programs'],
];

/*
 * Three lines, set as lines rather than as words.
 *
 * The reveal masks a whole line and slides it up out of its own box, so the
 * type never distorts and the baseline grid survives the animation. Breaking
 * it into words to blur each one in individually is the effect every generated
 * hero on the internet uses, and it fights a serif in particular — the
 * letterforms are the point of the face, and a blur is the one thing that
 * destroys them.
 *
 * The accent is the italic on the last line. Colour reinforces it; it does not
 * carry it alone, because a coloured phrase on a dark ground reads as a link,
 * and a headline that looks clickable and is not is a small lie.
 */
const HEADLINE = ['Everything an', 'institute runs on,'];
const HEADLINE_ACCENT = 'in one system.';

/*
 * The composer artifact's contents. Shapes, never figures: the dashboards
 * behind this page run on a fresh database, so a number here would be either a
 * zero or an invention. A bar can say "a result came back" honestly.
 */
const ASK_QUESTION = 'Which sections fell below 75% attendance this term?';
const ASK_SQL = 'select section, avg(present) from attendance group by 1';
const ASK_ROWS = [['BSCS-5A', '62%'], ['BSSE-3B', '78%'], ['BBA-1A', '44%']];

const DWELL = 5600;

/** Fire-once reveal. Content that re-enacts itself on every pass stops being
 *  content and becomes a fidget, so the observer unhooks after the first hit. */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      }),
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    );
    // The section rules are observed too. They carry no .rise-in styling —
    // `is-in` only starts their hairline drawing itself across the page.
    el.querySelectorAll('.rise-in, .sec--rule').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

export default function Welcome() {
  const navigate = useNavigate();
  const root = useReveal();

  const sources = useMemo(() => FRAMES.map((f) => f.src), []);
  usePreload(sources);

  const { index, swap, paused, go, holdProps } = useReel(FRAMES.length, DWELL);
  const active = FRAMES[index];

  /*
   * The header takes the call to action only while the hero's own is off
   * screen. Watched with an observer on the hero button rather than a scroll
   * position, so it stays correct at any viewport height without a magic
   * number that is right on one screen and wrong on the next.
   */
  const heroCta = useRef(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = heroCta.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([e]) => setArmed(!e.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toPortals = () => navigate('/choose-portal');

  // The ghost pill's job is to keep someone reading rather than to send them
  // somewhere, so it scrolls rather than navigates.
  const work = useRef(null);
  const toWork = () => work.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="aims-auth" ref={root}>
      <div className="stage stage--fixed" style={{ '--stage-hue': active.hue }}>
        {/* The clip is scrubbed, not looped: its playhead is the scroll position,
            so the footage advances because the reader advanced and rewinds when
            they go back up. See useScrollScrub. */}
        <StageBackdrop accent={`${active.hue}3d`} hue={active.hue} scrub />

        <header className={`stage__bar${armed ? ' is-armed' : ''}`}>
          <button type="button" className="auth-mark" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <span className="auth-mark__seal"><GraduationCap size={21} weight="fill" /></span>
            <span>
              <span className="auth-mark__name">AIIMS</span>
              <span className="auth-mark__sub">Institute Management</span>
            </span>
          </button>

          <div className="bar__act">
            <p className="t-body-sm ink-3 bar__says" style={{ letterSpacing: '.08em' }}>
              Student · Faculty · Parent · Admin
            </p>
            <button type="button" className="cta cta--sm bar__cta" onClick={toPortals} tabIndex={armed ? 0 : -1}>
              Choose your portal
              <ArrowRight size={15} weight="bold" />
            </button>
          </div>
        </header>

        {/* ── 1 · the ask ──────────────────────────────────── */}
        <section className="sec sec--wide sec--hero">
          <div className="hero__grid">
            <div>
              <p className="tag">Institute management system</p>

              <h1 className="hero__head">
                {HEADLINE.map((line, i) => (
                  <span className="hero__line" key={line}>
                    <b style={{ '--d': `${120 + i * 130}ms` }}>{line}</b>
                  </span>
                ))}
                <span className="hero__line">
                  <b style={{ '--d': `${120 + HEADLINE.length * 130}ms` }}>
                    <em className="hero__accent">{HEADLINE_ACCENT}</em>
                  </b>
                </span>
              </h1>

              <p className="hero__sub">
                Admissions through results, timetables through fees. One record per student,
                read four different ways — and each person sees exactly the part that is theirs.
              </p>

              {/* A matched pair on one baseline: the ask, and the way to keep
                  reading instead. The second is not a second portal button —
                  there is still exactly one of those on the page. */}
              <div className="hero__act">
                <button type="button" className="cta" onClick={toPortals} ref={heroCta}>
                  Choose your portal
                  <ArrowRight size={18} weight="bold" />
                </button>
                <button type="button" className="cta cta--ghost" onClick={toWork}>
                  See what it does
                  <CaretDown size={15} weight="bold" />
                </button>
              </div>
            </div>

            {/*
              The collage. Crisp vector UI sitting directly on top of the
              blurred clip — the contrast between the two is the depth cue, and
              it is also the honest one: what is sharp here is real, what is
              soft behind it is generated atmosphere.
            */}
            <div className="arts" aria-hidden="true">
              <div className="art" style={{ '--d': '700ms' }}>
                <p className="art__cap">Ask the data</p>
                <div className="art__field">
                  <span className="art__q">{ASK_QUESTION}</span>
                  <span className="art__send"><ArrowRight size={14} weight="bold" /></span>
                </div>
                <div className="art__wire"><code className="art__sql">{ASK_SQL}</code></div>
                <ul className="art__rows">
                  {ASK_ROWS.map(([code, w], i) => (
                    <li key={code} style={{ '--i': i, '--w': w, '--hue': i === 2 ? '#ffb1c4' : '#8fb4ff' }}>
                      <b>{code}</b>
                      <i />
                    </li>
                  ))}
                </ul>
              </div>

              <div className="art art--drift" style={{ '--d': '900ms' }}>
                <p className="art__cap">Arrange your dashboard</p>
                <div className="art__cells">
                  <span /><span /><span className="is-held" /><span /><span /><span />
                </div>
              </div>
            </div>
          </div>

          <div className="flow">
            <p className="flow__cap">One term, end to end</p>
            <ul className="flow__steps">
              {TERM.map((step) => (
                <li key={step}><b aria-hidden="true" />{step}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 2 · the product ─────────────────────────────────────────── */}
        <section className="sec sec--wide sec--rule" ref={work} aria-label="What AIIMS does">
          <div className="rise-in">
            <p className="tag">Inside</p>
            <h2 className="sec__head">Six things it does, <em>on real screens</em></h2>
            <p className="sec__sub">
              Not mockups. These are captures of the running application — shown against a
              fresh database, which is why the figures in them are zeros.
            </p>
          </div>

          <div className="reel rise-in" style={{ '--d': '90ms' }} {...holdProps}>
            <div className="reel__pane">
              {FRAMES.map((f, i) => (
                <img
                  key={f.src}
                  className={`reel__frame${i === index ? ' is-on' : ''}`}
                  src={f.src}
                  alt=""
                  aria-hidden="true"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                />
              ))}
            </div>

            <div>
              <ul className="reel__list">
                {FRAMES.map((f, i) => {
                  const Icon = f.icon;
                  const on = i === index;
                  return (
                    <li key={f.src}>
                      <button
                        type="button"
                        className={`reel__item${on ? ' is-on' : ''}`}
                        style={{ '--hue': f.hue }}
                        aria-current={on}
                        aria-expanded={on}
                        onClick={() => go(i)}
                      >
                        <span className="reel__ico"><Icon size={19} weight="duotone" /></span>
                        <span style={{ minWidth: 0 }}>
                          <span className="reel__name" style={{ display: 'block' }}>{f.name}</span>
                          <span className="reel__note"><span>{f.note}</span></span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div
                className={`reel__bar${paused ? ' is-held' : ''}`}
                style={{ '--hue': active.hue, '--dwell': `${DWELL}ms` }}
                aria-hidden="true"
              >
                <i key={swap} />
              </div>
            </div>
          </div>
        </section>

        {/* ── 3 · who it is for ───────────────────────────────────────── */}
        <section className="sec sec--rule sec--band" aria-label="Who it is for">
          <div className="rise-in">
            <p className="tag">Four portals</p>
            <h2 className="sec__head">One record, read <em>four different ways</em></h2>
            <p className="sec__sub">
              Each portal issues its own credential and opens on the part of the record that
              belongs to the person holding it.
            </p>
          </div>

          {/* No button in this section on purpose: the page makes its ask once,
              and this is the part that earns it. */}
          <div className="who">
            {PORTAL_ORDER.map((key, i) => {
              const p = PORTALS[key];
              const Icon = p.icon;
              return (
                <article
                  className="who__col rise-in"
                  key={p.id}
                  style={{ '--hue': p.hue, '--hue-ink': p.hueOnInk, '--d': `${60 + i * 70}ms` }}
                >
                  <span className="who__ico"><Icon size={22} weight="duotone" /></span>
                  <h3 className="who__name">{p.label}</h3>
                  <ul className="who__duties">
                    {p.duties.map((d) => (
                      <li key={d}><Check size={14} weight="bold" />{d}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

          {/*
            The one light surface on the page. It gets used here and nowhere
            else — the moment a second one appears, neither is an accent any
            more. It carries the claim that actually distinguishes this product,
            which is about permission rather than capability.
          */}
          <aside className="pull rise-in" style={{ '--d': '160ms' }}>
            <p className="pull__q">
              The assistant can only run <em>the query you could have run yourself.</em>
            </p>
            <p className="pull__by">
              Every question inherits the asker's role. A parent's answer stops at their own
              child; a teacher's stops at their own sections. Nothing is summarised by a
              language model on the way back — the rows you see are the rows the database
              returned.
            </p>
          </aside>
        </section>

        {/* ── 4 · the claims ──────────────────────────────────────────── */}
        <section className="sec sec--rule" aria-label="At a glance">
          <div className="rise-in">
            <p className="tag">Supplied platform figures — not readings from this deployment</p>
          </div>
          <div className="figs">
            {FIGURES.map(([value, label], i) => (
              <div className="fig rise-in" key={label} style={{ '--d': `${i * 80}ms` }}>
                <b>{value}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

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
