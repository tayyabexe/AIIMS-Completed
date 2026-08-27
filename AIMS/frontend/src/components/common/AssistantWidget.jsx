import { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { useChatbot } from '../../context/ChatbotContext';
import RichText from './RichText';
import AssistantCapabilities from './AssistantCapabilities';
import './AssistantWidget.css';

/*
 * The AIMS assistant, as a chat surface and nothing else.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 * -------------------------------
 * It holds no conversation state, makes no API call, and decides nothing about
 * who the user is. All of that is in ChatbotContext. This file turns
 * `messages` into DOM and turns typing into `send()`.
 *
 * WHY IT SHRANK
 * -------------
 * It used to import Recharts and render bar, line and pie charts, plus a
 * paginated data table, keyed off `response.type` being `chart` or `table`.
 *
 * Those branches were unreachable. The chatbot endpoint builds its envelope in
 * chatbotController with `type: "knowledge"` hardcoded — it is a documentation
 * service with no database tools, so it has no rows to plot and never sends
 * any. The chart code was inherited from the previous combined assistant,
 * which did have data tools, and it survived the split as dead weight: a
 * ~200kB charting library pulled into the bundle for a code path that could
 * not execute.
 *
 * The same was true of the tool badges, which rendered `message.tools` from a
 * `tools_used` field the chat response does not contain.
 *
 * Removing them is not only tidiness. A panel that can sprout a bar chart is
 * built like a dashboard; one that renders prose, a source list and the
 * occasional screen list is built like a chatbot, which is the only thing this
 * service can actually be.
 */

/*
 * Screens, rendered from structured rows rather than from prose.
 *
 * The backend sends these straight from its NAVIGATION table, never through
 * the model, so a route cannot drift when the model changes. That is why this
 * survived the cull while the charts did not: it is real, it arrives on
 * ordinary questions, and it is part of an answer rather than a data view.
 */
function NavList({ rows }) {
  return (
    <ul className="aw-nav">
      {rows.map((row) => (
        <li key={row.path}>
          <div className="aw-nav-head">
            <span className="aw-nav-name">{row.name}</span>
            <code className="aw-route">{row.path}</code>
          </div>
          {row.description && <span className="aw-nav-desc">{row.description}</span>}
        </li>
      ))}
    </ul>
  );
}

/*
 * The documents an answer was built from.
 *
 * Collapsed by default, and this is the compromise the "make it look like a
 * chatbot" pass settled on. Sources are the one piece of metadata worth
 * keeping: a fee deadline attributed to a named document can be checked, while
 * the same sentence unattributed has to be taken on trust — and a confident
 * sentence is exactly what a wrong answer also looks like.
 *
 * But a citation list stacked under every reply makes the panel read like a
 * search results page. Behind a one-line toggle, it is available to the reader
 * who wants to verify and invisible to the one who does not.
 */
function Sources({ items }) {
  const [shown, setShown] = useState(false);

  return (
    <div className="aw-cites">
      <button
        type="button"
        className="aw-cites-toggle"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
      >
        {shown ? 'Hide sources' : `Sources (${items.length})`}
      </button>

      {shown && (
        <ul>
          {items.map((c, i) => (
            <li key={i}>{c.section ? `${c.source} — ${c.section}` : c.source}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Message({ message }) {
  const { role, text, response, unverified, failed } = message;

  if (role === 'user') {
    return <div className="aw-msg aw-user"><p>{text}</p></div>;
  }

  return (
    <div className={`aw-msg aw-bot${failed ? ' aw-failed' : ''}`}>

      {/* An outage must look different from a normal answer. Placed above the
          prose, because a warning under an answer is read after the reader has
          already believed it. */}
      {unverified && (
        <p className="aw-unverified">
          <AlertTriangle size={12} />
          <span>
            The documentation index is offline, so this answer could not be
            checked against AIMS documentation. Treat it as unverified.
          </span>
        </p>
      )}

      {/* Markdown-as-React-elements, never as HTML. RichText builds <strong>,
          <ul> and <code> nodes with the model's text as escaped children, so
          there is no path from model output to markup. Unrecognised syntax
          renders as plain text rather than breaking. */}
      <RichText text={text} />

      {response?.navigation?.length > 0 && <NavList rows={response.navigation} />}

      {/* "What can you help me with?", answered by the backend WITHOUT the
          model: `items` comes straight from the server's capability
          catalogue, filtered to this user's role, so what is read here cannot
          drift when the model behind CHATBOT_MODEL changes.

          The sibling response type, `scope` — the controlled reply to a
          question outside AIMS — carries no items and renders as prose alone,
          because its sentence already names what is covered. A type this
          build does not recognise falls through to the prose above, which is
          always present. */}
      {response?.type === 'capabilities' && response?.items?.length > 0 && (
        <AssistantCapabilities items={response.items} />
      )}

      {response?.citations?.length > 0 && <Sources items={response.citations} />}
    </div>
  );
}

export default function AssistantWidget() {
  const {
    isOpen, open, close, portal,
    messages, busy, send, suggestions, isAvailable,
  } = useChatbot();

  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Focus the field when the panel opens, so the assistant can be used without
  // reaching for the mouse after clicking the button that opened it.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const submit = (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    send(text);
  };

  // Roles without an assistant get no button at all, rather than one that 403s.
  if (!isAvailable) return null;

  if (!isOpen) {
    return (
      <button type="button" className="aw-fab" onClick={open} aria-label="Open the AIMS assistant">
        <Bot size={22} />
      </button>
    );
  }

  return (
    <div className="aw-panel" role="dialog" aria-label="AIMS assistant">

      <header className="aw-head">
        <div className="aw-title">
          <Sparkles size={15} />
          <div>
            <strong>AIMS Assistant</strong>
            <small>{portal} portal</small>
          </div>
        </div>

        {/*
          * Close, and nothing else.
          *
          * The "start a new conversation" control has been removed. It offered
          * the user a decision they had no basis to make — nothing on screen
          * explained what carrying a thread forward costs or buys — and its
          * usual effect was to discard context the assistant was about to
          * need, because a follow-up question is the normal case rather than
          * the exception.
          *
          * A thread now lives for the signed-in session and is replaced when
          * the account changes. See ChatbotContext.
          */}
        <button type="button" onClick={close} title="Close" aria-label="Close the assistant">
          <X size={16} />
        </button>
      </header>

      <div className="aw-body">
        {messages.map((m, i) => <Message key={i} message={m} />)}

        {busy && (
          /*
           * A typing indicator rather than the old "Looking that up…" line.
           * Three dots is what a chat interface uses to say the other side is
           * composing, and it does not claim a particular activity — the
           * previous wording described a lookup even when the reply came
           * straight from the role rules with no lookup involved.
           */
          <div className="aw-msg aw-bot aw-typing" aria-label="The assistant is replying">
            <span /><span /><span />
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Offered only on an untouched thread. Once a real question has been
          asked they are clutter, and worse, they invite restarting rather than
          following up. */}
      {suggestions.length > 0 && messages.length === 1 && !busy && (
        <div className="aw-chips">
          {suggestions.map((s) => (
            <button type="button" key={s} onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}

      <form className="aw-input" onSubmit={submit}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          aria-label="Your question"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
          {busy ? <Loader2 size={15} className="aw-spin" /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}
