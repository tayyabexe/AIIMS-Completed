/*
 * The RAG chatbot — the documentation route.
 *
 * Answers how-does-this-work questions from the AIMS corpus. It holds no
 * database tools, so there is nothing here for a crafted question to reach.
 * Record and figure questions go to /api/analytics.
 */

const express = require("express");
const router = express.Router();

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/rbac.middleware");
const assistantRateLimit = require("../middlewares/assistantRateLimit.middleware");

const { CHATBOT_ROLES } = require("../config/chatbot");

const {
    chat,
    listConversations,
    getConversation,
    deleteConversation,
    capabilities
} = require("../controllers/chatbotController");

router.use(authenticate, authorize(...CHATBOT_ROLES));

// Only /chat spends tokens; reading your own transcripts is a cheap query.
router.post("/chat", assistantRateLimit, chat);

router.get("/conversations", listConversations);
router.get("/conversations/:id", getConversation);
router.delete("/conversations/:id", deleteConversation);

router.get("/capabilities", capabilities);

module.exports = router;
