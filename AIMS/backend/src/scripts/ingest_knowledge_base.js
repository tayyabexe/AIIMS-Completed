'use strict';

/*
 * Chunks the AIMS documentation, embeds it, and loads it into Qdrant.
 *
 * Usage:
 *   node src/scripts/ingest_knowledge_base.js            ingest everything
 *   node src/scripts/ingest_knowledge_base.js --check    report status only
 *
 * Idempotent: point ids are derived from the document path and the chunk
 * index, so a re-run overwrites a document's chunks rather than appending a
 * second copy. Without that, editing one paragraph and re-ingesting leaves the
 * old wording in the corpus, and the assistant retrieves both — reporting
 * superseded policy as current.
 *
 * CHUNKING
 * --------
 * Split on markdown headings, not on a fixed character count. Institutional
 * documentation is already organised by topic, and a heading is the author
 * telling you where one idea ends. Fixed-size windows cut a fee deadline away
 * from the sentence that qualifies it.
 *
 * Each chunk carries its document title and heading into the embedded text, so
 * a chunk that says "this must be submitted within 7 days" still embeds near
 * "transcript request", which is in its heading rather than its body.
 *
 * AUDIENCE
 * --------
 * Read from each document's front matter. It is a permission — see
 * vectorStore.search — so a document with no explicit audience defaults to
 * `staff`, the most restrictive, rather than to `all`. Forgetting to tag a
 * document must not publish it to students.
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const vectorStore = require('../services/assistant/rag/vectorStore');
const { embed } = require('../services/assistant/rag/embedder');

const DOCS_DIR = path.join(__dirname, '..', '..', 'docs', 'knowledge-base');

const VALID_AUDIENCES = new Set(['all', 'student', 'teacher', 'staff', 'parent']);

/*
 * The floor for the HEADLESS preamble — whatever sits between "# Title" and
 * the first "##". That text has no heading to anchor it, so a short fragment
 * of it really is noise and is dropped.
 */
const MIN_CHUNK_CHARS = 120;

/*
 * The floor for a section that HAS a heading, which is far lower, because the
 * heading is itself indexed.
 *
 * This used to be the same 120, and it was silently deleting real answers. A
 * good FAQ entry is short: "Where do I see my own teaching timetable?" has a
 * 47-character body, and 11 sections across the corpus were below the old
 * floor — including "Changing your password", the canonical instruction for
 * the most common support question there is.
 *
 * The original reasoning ("a stray heading with no body adds noise") was sound
 * but measured the wrong thing. What makes a chunk retrievable is the embedded
 * text, and that is `title — section\n\ncontent`. A 47-character body under a
 * question-shaped heading embeds extremely well; it is the headless fragment
 * with no heading at all that has nothing to match on.
 *
 * Anything below even this floor is merged into the preceding chunk rather
 * than discarded, so no authored sentence can leave the corpus silently.
 */
const MIN_SECTION_CHARS = 40;

/*
 * Above this a chunk covers too much to be a precise answer. Long sections are
 * split on paragraph boundaries rather than mid-sentence.
 *
 * Lowered from 1,800 to 900. Note what this does and does not do: the measured
 * corpus has a 1,067-character maximum and a 248-character median, so at 1,800
 * this limit NEVER FIRED - not once across 190 chunks. It was dead
 * configuration that looked like a tuning knob.
 *
 * At 900 it catches the handful of genuinely long sections, and it is a real
 * floor under future documents rather than a number that happens to sit above
 * everything currently written.
 *
 * It is deliberately not lower. "Reduce the chunk length to improve precision"
 * is sound advice for a corpus chunked by character count; this one is chunked
 * by heading, which means the author already decided where one idea ends.
 * Cutting below that separates a rule from the sentence that qualifies it -
 * "attendance is marked per session" from "marking the same session twice is
 * rejected" - and a retrieved half-rule reads as a whole one.
 */
const MAX_CHUNK_CHARS = 900;

/*
 * How much of the PREVIOUS section is carried into a chunk's embedded text.
 *
 * This is the overlap, and it exists only in the vector - never in the stored
 * content. That split is the point.
 *
 * The problem it solves: headings cut a document at the author's idea
 * boundaries, which is right for reading and lossy for retrieval. A section
 * headed "Correcting a mistake" embeds with no idea it is about ATTENDANCE,
 * because the word appears only in the section above it. A question phrased
 * "how do I fix a wrong attendance mark" then misses it.
 *
 * Carrying the tail of the previous section into the embedding puts the chunk
 * back in the right neighbourhood without changing a word of what the model is
 * eventually shown. Overlapping the STORED text instead would mean two
 * retrieved neighbours repeat the same sentences at each other, spending the
 * prompt budget twice on one paragraph - which matters much more now that
 * topK is 10.
 *
 * 200 characters is roughly two sentences: enough to carry the subject of the
 * previous section, short enough that it cannot outweigh the chunk's own text
 * in a mean-pooled embedding.
 */
const OVERLAP_CHARS = 200;

/*
 * Front matter is a few `key: value` lines between --- fences. A YAML parser
 * would be a dependency for four keys that are always plain strings.
 */
const parseFrontMatter = (raw) => {

    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

    if (!match) return { meta: {}, body: raw };

    const meta = {};

    for (const line of match[1].split(/\r?\n/)) {
        const pair = line.match(/^(\w+):\s*(.*)$/);
        if (pair) meta[pair[1]] = pair[2].trim();
    }

    return { meta, body: raw.slice(match[0].length) };
};

/** Splits an over-long section on paragraph boundaries. */
const splitLongSection = (text) => {

    if (text.length <= MAX_CHUNK_CHARS) return [text];

    const parts = [];
    let current = '';

    for (const paragraph of text.split(/\r?\n\r?\n/)) {

        if (current && (current.length + paragraph.length) > MAX_CHUNK_CHARS) {
            parts.push(current.trim());
            current = '';
        }

        current += `${paragraph}\n\n`;
    }

    if (current.trim()) parts.push(current.trim());

    return parts;
};

/**
 * @param {string}   body     the document with front matter already stripped
 * @param {Function} [onNote] called for every section not indexed as its own
 *                            chunk, so the caller can report it. Silence here
 *                            is what let 11 sections go missing unnoticed.
 */
const chunkDocument = (body, onNote) => {

    const chunks = [];
    const lines = body.split(/\r?\n/);

    /*
     * The heading PATH, not the last heading seen.
     *
     * `##` and `###` were treated identically, so a chunk under
     *
     *     ## Accounts and passwords
     *     ### Changing your password
     *
     * was indexed as "Changing your password" and its embedded text never
     * contained the word "account" at all. The parent heading is where the
     * subject usually lives; the child heading is often only the verb.
     *
     * Held as a two-slot array - [h2, h3] - and rendered as `parent > child`.
     * A `##` clears the `###` beneath it, which is what stops a subsection
     * heading leaking sideways into the next top-level section.
     */
    let path = [null, null];
    let buffer = [];

    // Held from a headless preamble until the first real chunk exists to
    // attach it to. See the note in flush().
    let preamble = '';

    // "Accounts and passwords > Changing your password", or whichever single
    // level is set. null until the first heading, which is how a headless
    // preamble is told apart from a real section that happens to be short.
    const sectionName = () => {
        const parts = path.filter(Boolean);
        return parts.length ? parts.join(' > ') : null;
    };

    const flush = () => {
        const text = buffer.join('\n').trim();
        buffer = [];
        if (!text) return;

        const heading = sectionName();
        const headed = heading !== null;
        const section = headed ? heading : 'Overview';
        const floor = headed ? MIN_SECTION_CHARS : MIN_CHUNK_CHARS;

        for (const part of splitLongSection(text)) {

            if (part.length >= floor) {

                // The document's opening lines belong to its first section.
                const content = preamble && !chunks.length
                    ? `${preamble}\n\n${part}`
                    : part;

                if (!chunks.length) preamble = '';

                chunks.push({ section, content });
                continue;
            }

            /*
             * Below the floor. A headed section is folded into the previous
             * chunk with its heading kept as a lead-in, so the words stay
             * searchable even though they no longer have their own vector.
             * Only a headless fragment, or a short section that has nothing
             * before it to merge into, is actually dropped.
             */
            if (headed && chunks.length) {
                const previous = chunks[chunks.length - 1];
                previous.content += `\n\n${section}\n${part}`;
                onNote?.({ section, chars: part.length, action: 'merged' });
                continue;
            }

            /*
             * A short HEADLESS preamble - the text between `# Title` and the
             * first `##`. It has nothing before it to merge into, so it used
             * to be dropped outright.
             *
             * Measured across the corpus, that discarded 22 fragments, and
             * while most were just the `# Title` line, the longest were real:
             * the Admin Portal Guide opened with 112 characters explaining
             * that Super Admin and Admin share the same reach, and that
             * sentence left the corpus without ever being indexed.
             *
             * It is now held and prepended to the FIRST real chunk of the
             * document instead, which is the chunk it was written to
             * introduce. Nothing authored leaves the corpus, and no fragment
             * gets a vector of its own that would compete with the sections
             * that actually answer questions.
             */
            preamble = preamble ? `${preamble}\n\n${part}` : part;
            onNote?.({ section, chars: part.length, action: 'carried' });
        }
    };

    for (const line of lines) {
        // ## and ### start a new chunk. A single # is the document title.
        const match = line.match(/^(#{2,3})\s+(.*)$/);

        if (match) {
            flush();

            const depth = match[1].length;   // 2 or 3
            const text = match[2].trim();

            if (depth === 2) {
                // A new top-level section retires whatever subsection was
                // open under the previous one.
                path = [text, null];
            } else {
                path = [path[0], text];
            }

            continue;
        }

        buffer.push(line);
    }

    flush();

    return chunks;
};

/*
 * A deterministic unsigned 64-bit id from the document path and chunk index.
 * Qdrant accepts an unsigned integer or a UUID, not an arbitrary string, and
 * deriving it means a re-ingest lands on the same point.
 */
const pointId = (source, index) =>
    Number(
        BigInt(`0x${crypto.createHash('sha1')
            .update(`${source}#${index}`)
            .digest('hex')
            .slice(0, 12)}`)
    );

(async () => {

    const checkOnly = process.argv.includes('--check');

    if (!fs.existsSync(DOCS_DIR)) {
        console.error(`No knowledge base at ${DOCS_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(DOCS_DIR)
        .filter((f) => f.endsWith('.md'))
        .sort();

    console.log(`documents : ${files.length}`);

    if (checkOnly) {
        console.log('qdrant    :', JSON.stringify(await vectorStore.stats()));
        process.exit(0);
    }

    const created = await vectorStore.ensureCollection();
    console.log(`collection: ${vectorStore.COLLECTION} ${created ? '(created)' : '(exists)'}`);

    let totalChunks = 0;
    const totalNotes = { merged: 0, dropped: 0, carried: 0 };

    for (const file of files) {

        const raw = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
        const { meta, body } = parseFrontMatter(raw);

        // Defaults to the most restrictive audience, deliberately: an untagged
        // document must not be published to students by accident.
        const audience = VALID_AUDIENCES.has(meta.audience) ? meta.audience : 'staff';

        if (!VALID_AUDIENCES.has(meta.audience)) {
            console.warn(
                `  ! ${file} has no valid audience; defaulting to "staff". ` +
                `Add "audience: all" to publish it to students.`
            );
        }

        const title = meta.title || file.replace(/\.md$/, '');

        /*
         * Collected per document and printed below. A section that does not
         * become its own chunk is a retrieval hole, and the only reason the
         * last one went unnoticed for so long is that this loop reported chunk
         * counts and nothing else.
         */
        const notes = [];
        const chunks = chunkDocument(body, (note) => notes.push(note));

        if (!chunks.length) {
            console.log(`  - ${file}: no usable chunks, skipped`);
            continue;
        }

        // Replace rather than merge, so a heading removed from the document
        // does not linger in the index.
        await vectorStore.deleteBySource(title);

        /*
         * The document title and section heading are prepended to the embedded
         * text, but NOT to the stored content. The model should be given the
         * paragraph as written; the headings are there to put the vector in
         * the right neighbourhood.
         */
        /*
         * What gets EMBEDDED, which is not what gets stored.
         *
         * Three parts, in ascending order of importance to the vector:
         *
         *   1. The document title and the heading path. A chunk that reads
         *      "raise it with the subject teacher" is about ATTENDANCE only
         *      because of the heading above it.
         *   2. The tail of the PREVIOUS chunk - the overlap. See
         *      OVERLAP_CHARS: it carries the subject across a heading
         *      boundary, which is where the author's structure and the
         *      retriever's needs disagree.
         *   3. The chunk's own text.
         *
         * The overlap is prefixed rather than appended so the chunk's own
         * words end the string. Mean pooling has no positional bias, but a
         * human reading a retrieval debug dump does, and putting borrowed
         * text first makes it obvious which half is borrowed.
         *
         * None of this reaches `payload.content` below. The model is shown
         * the paragraph as written; these additions exist only to put the
         * vector in the right neighbourhood.
         */
        const embedText = chunks.map((chunk, i) => {

            const previous = i > 0
                ? chunks[i - 1].content.slice(-OVERLAP_CHARS).trim()
                : '';

            return [
                `${title} — ${chunk.section}`,
                previous,
                chunk.content
            ].filter(Boolean).join('\n\n');
        });

        const vectors = await embed(embedText);

        await vectorStore.upsert(chunks.map((chunk, i) => ({
            id: pointId(title, i),
            vector: vectors[i],
            payload: {
                source: title,
                section: chunk.section,
                content: chunk.content,
                audience,
                file
            }
        })));

        totalChunks += chunks.length;
        console.log(`  + ${file}: ${chunks.length} chunks [${audience}]`);

        for (const note of notes) {
            totalNotes[note.action] += 1;

            // A merge is a design decision working; a drop is content leaving
            // the corpus, so only the drop is worth a warning marker.
            // A merge or a carry is a design decision working; only a DROP is
            // content leaving the corpus, so only that gets a warning marker.
            console.log(
                `      ${note.action === 'dropped' ? '!' : '~'} ${note.action}: ` +
                `"${note.section}" (${note.chars} chars)`
            );
        }
    }

    const stats = await vectorStore.stats();

    console.log(`\ningested  : ${totalChunks} chunks`);
    console.log(`merged    : ${totalNotes.merged} short sections folded into a neighbour`);
    console.log(`carried   : ${totalNotes.carried} preambles attached to their first section`);
    console.log(`dropped   : ${totalNotes.dropped} fragments not indexed`);
    console.log(`collection: ${JSON.stringify(stats)}`);

    process.exit(0);

})().catch((error) => {
    console.error('\nINGEST FAILED:', error.message);

    if (/ECONNREFUSED|fetch failed/i.test(error.message)) {
        console.error(
            'Qdrant does not appear to be running. Start it with:\n' +
            '  docker compose -f docker-compose.qdrant.yml up -d'
        );
    }

    process.exit(1);
});
