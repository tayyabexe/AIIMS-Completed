import { BookOpen, Compass } from 'lucide-react';

/*
 * What the assistant covers, rendered from data the backend decided.
 *
 * WHY THIS IS A COMPONENT AND NOT PROSE IN THE REPLY
 * -------------------------------------------------
 * Exactly the reasoning behind NavList in AssistantWidget. "What can you help
 * me with?" used to be answered by the language model reading whatever the
 * retriever happened to return, so the list changed between askings, arrived
 * as raw markdown the widget renders only approximately, and periodically
 * named a module the reader's role has no screen for.
 *
 * The list now comes from backend/src/config/assistantCapabilities.js, filtered
 * to the caller's scope on the server, and travels as
 * `{ type: 'capabilities', items: [...] }`. Nothing here is generated: this
 * file decides how the items look and nothing about what they say.
 *
 * TWO VARIANTS, ONE COMPONENT
 * ---------------------------
 * `capabilities` answers "what do you do". `scope` answers a question that was
 * outside AIMS altogether — "what's the weather" — and shows the same list as
 * the recovery: the refusal sentence says what is not covered, and the list
 * says what is, so the user does not have to guess twice.
 *
 * They share a renderer because they are the same list with a different reason
 * for appearing. The visual difference is the header, which is the part that
 * carries the reason.
 */

const HEADINGS = {
  capabilities: { Icon: BookOpen, label: 'What I can help with' },
  scope: { Icon: Compass, label: 'What I do cover' },
};

export default function AssistantCapabilities({ items, variant = 'capabilities' }) {
  if (!items?.length) return null;

  const { Icon, label } = HEADINGS[variant] || HEADINGS.capabilities;

  return (
    <section className={`aw-caps aw-caps-${variant}`} aria-label={label}>
      <h4 className="aw-caps-head">
        <Icon size={12} aria-hidden="true" />
        <span>{label}</span>
      </h4>

      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span className="aw-caps-name">{item.title}</span>

            {/* The summary is what stops the list being a menu of nouns. A
                reader who does not already know what "Enrollment" covers is
                exactly the reader who asked the question. */}
            {item.summary && <span className="aw-caps-desc">{item.summary}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
