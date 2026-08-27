/*
 * A deliberately small markdown renderer for assistant replies.
 *
 * Not a markdown library, and not `dangerouslySetInnerHTML`. Every branch here
 * returns React elements with the matched text as a child, so React escapes it
 * the same way the old plain-text renderer did. The security property the
 * previous implementation was protecting — model output can never become HTML
 * — is unchanged; what changes is that `**Fees**` now reaches the user as bold
 * text rather than as four literal asterisks.
 *
 * It handles the subset models actually emit: bold, inline code, bullet and
 * numbered lists, headings, and bare /routes. ANYTHING ELSE FALLS THROUGH AS
 * PLAIN TEXT, which is the important design property. The model behind
 * CHATBOT_MODEL will be replaced eventually, and the next one will format
 * differently; an unrecognised construct must degrade to readable prose rather
 * than to a broken layout or an empty message.
 */

const BULLET = /^\s*[-*+•]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,6}\s+/;

/*
 * A portal route on its own, used to decide whether `backticked` text is a
 * route rather than generic code. Models wrap paths in backticks about half
 * the time, and `/admin/fees` should not look different from /admin/fees just
 * because the model reached for a code fence.
 */
const ROUTE_ONLY = /^\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*$/i;

/*
 * One pass, alternation ordered longest-first so `**x**` is consumed as bold
 * before `*x*` can claim the inner pair.
 *
 * No lookbehind: it would be the natural way to stop a route matching inside
 * a word, but Safari only gained support in 16.4 and this widget renders on
 * whatever the campus has. The preceding character is checked by hand below.
 */
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\n]+)\*|(\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*)/gi;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let last = 0;
  let match;

  INLINE.lastIndex = 0;

  while ((match = INLINE.exec(text)) !== null) {
    const [raw, bold, boldAlt, code, italic, route] = match;

    /*
     * A route only counts when it starts a word. Without this, the "/" in
     * "either/or" and the tail of a URL both render as portal routes.
     */
    if (route && match.index > 0 && /[\w/]/.test(text[match.index - 1])) continue;

    if (match.index > last) nodes.push(text.slice(last, match.index));
    last = match.index + raw.length;

    const key = `${keyPrefix}-${match.index}`;

    if (bold || boldAlt) nodes.push(<strong key={key}>{bold || boldAlt}</strong>);
    else if (code) {
      nodes.push(
        <code key={key} className={ROUTE_ONLY.test(code.trim()) ? 'aw-route' : 'aw-code'}>
          {code}
        </code>
      );
    }
    else if (italic) nodes.push(<em key={key}>{italic}</em>);
    else nodes.push(<code key={key} className="aw-route">{route}</code>);
  }

  if (last < text.length) nodes.push(text.slice(last));

  return nodes.length ? nodes : text;
}

/*
 * Groups consecutive list lines into a single <ul>/<ol>.
 *
 * Line-at-a-time rendering, which is what the widget did before, produces a
 * separate one-item list per bullet — visually almost right, and wrong in the
 * accessibility tree, where a screen reader announces "list, 1 item" eleven
 * times instead of "list, 11 items".
 */
function toBlocks(text) {
  const blocks = [];

  for (const line of String(text).split('\n')) {
    if (!line.trim()) { blocks.push(null); continue; }

    const kind = BULLET.test(line) ? 'ul' : ORDERED.test(line) ? 'ol' : null;

    if (!kind) {
      blocks.push(HEADING.test(line)
        ? { type: 'h', text: line.replace(HEADING, '') }
        : { type: 'p', text: line.trim() });
      continue;
    }

    const previous = blocks[blocks.length - 1];
    const item = line.replace(kind === 'ul' ? BULLET : ORDERED, '');

    if (previous && previous.type === kind) previous.items.push(item);
    else blocks.push({ type: kind, items: [item] });
  }

  return blocks.filter(Boolean);
}

export default function RichText({ text }) {
  if (!text) return null;

  return toBlocks(text).map((block, i) => {
    if (block.type === 'h') {
      return <p key={i} className="aw-h">{renderInline(block.text, i)}</p>;
    }

    if (block.type === 'p') {
      return <p key={i}>{renderInline(block.text, i)}</p>;
    }

    const List = block.type === 'ul' ? 'ul' : 'ol';

    return (
      <List key={i} className="aw-list">
        {block.items.map((item, j) => (
          <li key={j}>{renderInline(item, `${i}-${j}`)}</li>
        ))}
      </List>
    );
  });
}
