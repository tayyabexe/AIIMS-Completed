/*
 * Text embeddings, computed locally.
 *
 * WHY LOCAL
 * ---------
 * Groq serves no embeddings endpoint, so vectors have to come from somewhere
 * else. The alternatives were a second cloud provider (another key to manage,
 * a per-token cost on every ingest AND every question, another rate limit,
 * another outage that takes documentation search down) or running the model
 * here.
 *
 * all-MiniLM-L6-v2 is 384-dimensional, about 90 MB, and runs on CPU through
 * ONNX in tens of milliseconds. For a corpus of institutional documentation —
 * a few hundred chunks of policy and procedure — its retrieval quality is not
 * the limiting factor; how well the documents are written is.
 *
 * THE MODEL IS LOADED ONCE
 * ------------------------
 * First use downloads the weights and takes a few seconds. Every use after
 * that is in-process. The promise itself is cached rather than the resolved
 * pipeline, so concurrent first calls await one load instead of racing three.
 */

const config = require("../../../config/assistant");

let pipelinePromise = null;

/*
 * @xenova/transformers is an ES module, so it is reached through a dynamic
 * import from this CommonJS file. Doing it lazily also means a backend that
 * never touches the assistant never pays the load.
 */
const getPipeline = () => {

    if (!pipelinePromise) {

        pipelinePromise = (async () => {

            const { pipeline, env } = await import("@xenova/transformers");

            // Weights are cached next to the app rather than in a home
            // directory, so a deployment that resets $HOME does not silently
            // re-download 90 MB on every boot.
            env.cacheDir = require("path").join(__dirname, "..", "..", "..", "..", ".models");

            // No remote code execution: only the model weights are fetched.
            env.allowLocalModels = true;

            return pipeline("feature-extraction", config.rag.embeddingModel);
        })().catch((error) => {
            // A failed load must not be cached, or every later call gets the
            // same rejection and the model is never retried.
            pipelinePromise = null;
            throw error;
        });
    }

    return pipelinePromise;
};

/**
 * Embeds one or more strings.
 *
 * Mean pooling and L2 normalisation are applied, which is what MiniLM expects
 * and what makes cosine similarity meaningful — Qdrant's Cosine distance
 * assumes unit vectors, and skipping the normalisation quietly degrades every
 * score rather than failing.
 *
 * @param {string|string[]} input
 * @returns {Promise<number[][]>} one vector per input
 */
const embed = async (input) => {

    const texts = (Array.isArray(input) ? input : [input])
        .map((t) => String(t || "").trim())
        .filter(Boolean);

    if (!texts.length) return [];

    const extract = await getPipeline();

    const output = await extract(texts, { pooling: "mean", normalize: true });

    /*
     * The tensor comes back flattened: one contiguous Float32Array of
     * texts.length * dims. It is sliced back into rows here rather than by the
     * caller, so nothing downstream has to know the tensor layout.
     */
    const dims = output.dims[output.dims.length - 1];
    const flat = Array.from(output.data);

    return texts.map((_, i) => flat.slice(i * dims, (i + 1) * dims));
};

/** Embeds a single string and returns one vector. */
const embedOne = async (text) => (await embed(text))[0];

/**
 * Warms the model so the first user question does not pay the load.
 * Safe to call at boot and safe to fail — it is an optimisation.
 */
const warmup = async () => {
    try {
        await embedOne("warmup");
        return { ok: true, dimensions: config.rag.embeddingDim };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
};

module.exports = { embed, embedOne, warmup };
