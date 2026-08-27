/*
 * Qdrant-backed documentation search.
 *
 * AUDIENCE FILTERING IS A PERMISSION, NOT A RANKING SIGNAL
 * -------------------------------------------------------
 * Some AIMS documentation is staff-facing: how credentials are reissued, how
 * marks are verified before release, how fee payments are approved. A student
 * must not receive those merely because the chunk scored well against their
 * question.
 *
 * So `audience` is applied as a Qdrant filter, evaluated before scoring, not
 * as a re-rank or a post-hoc slice of the results. A student's query never
 * retrieves a staff-only chunk in the first place, so there is nothing for a
 * cleverly-worded question to surface.
 *
 * A MINIMUM SCORE IS ENFORCED
 * ---------------------------
 * Vector search always returns its k nearest neighbours, however far away they
 * are. Without a floor, a question the corpus does not cover comes back with
 * its three least-irrelevant chunks and the model answers confidently from
 * them. The floor is what turns "no match" into an honest "not documented".
 */

const config = require("../../../config/assistant");
const { embed, embedOne } = require("./embedder");

const COLLECTION = config.rag.collection;

let clientPromise = null;

const getClient = () => {

    if (!clientPromise) {
        clientPromise = (async () => {
            const { QdrantClient } = require("@qdrant/js-client-rest");
            return new QdrantClient({ url: config.rag.qdrantUrl, checkCompatibility: false });
        })().catch((error) => {
            clientPromise = null;
            throw error;
        });
    }

    return clientPromise;
};

/**
 * Creates the collection if it is absent.
 *
 * Cosine distance, matching the normalised vectors the embedder produces.
 * `audience` is indexed as a keyword field because it is filtered on every
 * single query — without the index Qdrant scans, which is fine at a few
 * hundred points and not fine later.
 */
const ensureCollection = async () => {

    const client = await getClient();

    const { exists } = await client.collectionExists(COLLECTION);
    if (exists) return false;

    await client.createCollection(COLLECTION, {
        vectors: { size: config.rag.embeddingDim, distance: "Cosine" }
    });

    await client.createPayloadIndex(COLLECTION, {
        field_name: "audience",
        field_schema: "keyword"
    });

    // Filtered on for incremental re-ingest of a single document.
    await client.createPayloadIndex(COLLECTION, {
        field_name: "source",
        field_schema: "keyword"
    });

    return true;
};

/**
 * Inserts or replaces chunks.
 *
 * Ids are supplied by the caller and derived from the document and chunk
 * index, so re-ingesting a document overwrites its chunks rather than
 * duplicating them. An ingest script that appends every run produces a corpus
 * where the same paragraph is retrieved three times and the model reports it
 * as three sources.
 */
const upsert = async (points) => {

    if (!points.length) return 0;

    const client = await getClient();

    // Batched because a whole corpus in one request is a large body and one
    // failure loses everything.
    const BATCH = 64;

    for (let i = 0; i < points.length; i += BATCH) {
        await client.upsert(COLLECTION, {
            wait: true,
            points: points.slice(i, i + BATCH)
        });
    }

    return points.length;
};

/**
 * Semantic search.
 *
 * @param {string} question
 * @param {{ topK?: number, minScore?: number, audience?: string }} options
 * @returns {Promise<Array<{ source, section, content, score }>>}
 */
const search = async (question, options = {}) => {

    const client = await getClient();
    const vector = await embedOne(question);

    if (!vector) return [];

    const audience = options.audience;

    /*
     * "all" is every document readable by any role. A student's query matches
     * `all` or `student`; it can never match `staff`. Admins are given no
     * filter at all, because there is no AIMS documentation an administrator
     * may not read.
     */
    const filter = audience && audience !== "admin"
        ? { must: [{ key: "audience", match: { any: ["all", audience] } }] }
        : undefined;

    /*
     * `query`, not `search`.
     *
     * The REST client removed `client.search()` at v1.13 in favour of the
     * unified `query` API, and this package is on 1.19. Calling the old name
     * throws "client.search is not a function" — which, because Qdrant is
     * optional and its absence is handled gracefully, surfaced as a
     * plausible-looking "documentation unavailable" message rather than as an
     * obvious bug. It was caught by reading the error text, not the behaviour.
     *
     * `query` also returns `{ points }` rather than a bare array.
     */
    const { points } = await client.query(COLLECTION, {
        query: vector,
        limit: options.topK ?? config.rag.topK,
        score_threshold: options.minScore ?? config.rag.minScore,
        filter,
        with_payload: true
    });

    return (points || []).map((hit) => ({
        source: hit.payload.source,
        section: hit.payload.section,
        content: hit.payload.content,
        audience: hit.payload.audience,
        score: hit.score
    }));
};

/** Removes every chunk of one document, so it can be re-ingested cleanly. */
const deleteBySource = async (source) => {
    const client = await getClient();
    await client.delete(COLLECTION, {
        wait: true,
        filter: { must: [{ key: "source", match: { value: source } }] }
    });
};

/** Point count and reachability, for the health endpoint and the ingest script. */
const stats = async () => {
    try {
        const client = await getClient();
        const info = await client.getCollection(COLLECTION);
        return {
            ok: true,
            points: info.points_count ?? 0,
            dimensions: info.config?.params?.vectors?.size
        };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
};

module.exports = {
    ensureCollection,
    upsert,
    search,
    deleteBySource,
    stats,
    embed,
    COLLECTION
};
