import {
  createContext, useContext, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAuth } from './AuthContext';
import { assistant } from '../api/assistant';
import { ROLES, ROLE_LABELS } from '../api/roles';

/*
 * The assistant's state, and the only place it lives.
 *
 * WHY THE CONVERSATION IS HERE AND NOT IN THE WIDGET
 * --------------------------------------------------
 * The messages, the pending flag and the send() call used to sit in
 * AssistantWidget as local component state. That was survivable only because
 * the widget happens never to unmount — it returns a floating button when
 * closed rather than returning null, so React keeps the state alive by
 * accident rather than by design.
 *
 * Two things made that untenable:
 *
 *   1. The "start a new conversation" button is gone. A thread is now expected
 *      to persist for the whole session, so where it is kept stops being an
 *      implementation detail and becomes the feature.
 *   2. Nothing outside the widget could reach the conversation. A header that
 *      wants to open the assistant on a question — "explain this screen" —
 *      had no way to put a message into it.
 *
 * So the context owns the transcript and exposes send(). The widget renders
 * it and does nothing else.
 *
 * WHO GETS THE ASSISTANT
 * ----------------------
 * Super Admin, Admin, Teacher and Student. Parent, HR, Accountant and Library
 * do not — the backend refuses them with a 403 before spending a token, and
 * this flag keeps the button from appearing at all so nobody is offered a
 * feature that will reject them.
 *
 * WHY ROLE AND PORTAL ARE DERIVED, NOT ANNOUNCED
 * ----------------------------------------------
 * This used to hold `portal` and `userName` as plain state that each portal's
 * header pushed in through `configure()`, and `configure` ignored falsy values
 * (`if (u) setUserName(u)`). Three things then went wrong together:
 *
 *   1. StudentTopBar passes `profile.fullName`, which is undefined until the
 *      profile fetch lands. The falsy guard skipped it, so the PREVIOUS value
 *      survived.
 *   2. Nothing reset on sign-in, so that previous value could belong to a
 *      different account entirely.
 *   3. Nothing reset on sign-out either.
 *
 * The visible result was a student being greeted "Hi Admin2 — I'm the AIMS
 * assistant for the Student portal": an admin's email-derived name welded onto
 * a student's portal, in one sentence, from two different sessions.
 *
 * So the identity that MATTERS is derived from `user.roleId` — the same value
 * the JWT carries and the backend authorises against — and cannot be
 * overwritten by a header. `configure()` survives for one narrow job:
 * upgrading the DISPLAY NAME once a portal has loaded a better one than the
 * account itself carries.
 */
const ASSISTANT_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.TEACHER,
  ROLES.STUDENT,
];

/*
 * roleId -> the scope string the backend resolves for this account.
 *
 * These four values are the contract with `scope.service.resolveFor` on the
 * server: "admin", "teacher", "student", "parent". The widget uses the same
 * vocabulary so that what the greeting claims and what the backend actually
 * authorises can never disagree.
 */
const SCOPE_FOR_ROLE = {
  [ROLES.SUPER_ADMIN]: 'admin',
  [ROLES.ADMIN]: 'admin',
  [ROLES.TEACHER]: 'teacher',
  [ROLES.STUDENT]: 'student',
  [ROLES.PARENT]: 'parent',
};

// The portal label the user actually sees. Distinct from the scope: the
// teacher scope lives in a portal called "Faculty", and greeting a teacher
// with "the teacher portal" names a screen that does not exist.
const PORTAL_FOR_SCOPE = {
  admin: 'Admin',
  teacher: 'Faculty',
  student: 'Student',
  parent: 'Parent',
};

/*
 * What the assistant offers, per role.
 *
 * One line each, naming things that role can ACTUALLY do. The old greeting
 * offered "attendance, marks, fees, timetables" to everybody, which is a
 * student's list — a teacher has no fees and an admin has no "my timetable".
 * Opening by offering someone a thing they cannot have is how a conversation
 * starts with a wrong answer.
 */
const OFFERS = {
  student: 'your attendance, marks and results, fee vouchers, timetable, or how '
    + 'something in the portal works',
  teacher: 'marking attendance, entering and publishing marks, your classes and '
    + 'rosters, assignments, or how something in the Faculty portal works',
  admin: 'admissions, fees, examinations, user accounts and credentials, audit '
    + 'logs, or how any part of AIMS works',
  parent: "your child's attendance, results, fees and timetable, or how "
    + 'something in the portal works',
};

/*
 * The opening message.
 *
 * `firstName` may legitimately be null — an account with no name recorded — so
 * it falls back to "there" rather than to a placeholder like "User". A
 * greeting that addresses someone by a placeholder is worse than one that does
 * not address them at all: it looks like the system knows who they are and has
 * it wrong.
 */
const greetingFor = (firstName, portal, scope) => ({
  role: 'bot',
  text: `Hi ${firstName || 'there'} — I'm the AIMS assistant for the ${portal} `
    + `portal. Ask me about ${OFFERS[scope] || 'how something in AIMS works'}.`,
});

const ChatbotContext = createContext(null);

export function ChatbotProvider({ children }) {
  const { user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);

  /*
   * The name a portal supplied, which may be better than the account's own.
   *
   * Held separately from the account name rather than merged into one piece of
   * state, so that "the student profile has not loaded yet" and "this account
   * has no name" stay distinguishable. Merging them is what let one account's
   * name leak into another's session.
   */
  const [nameOverride, setNameOverride] = useState(null);

  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  /*
   * The server owns the transcript; this is only which thread is active.
   * Keeping the messages on the server as well would give two sources of truth
   * that drift the moment a request fails halfway, so the array above is the
   * render copy and this id is what ties it to the stored one.
   */
  const [conversationId, setConversationId] = useState(null);

  const abortRef = useRef(null);

  const scope = SCOPE_FOR_ROLE[user?.roleId] || null;
  const portal = PORTAL_FOR_SCOPE[scope] || 'Institute';
  const roleLabel = ROLE_LABELS[user?.roleId] || 'User';

  const isAvailable = ASSISTANT_ROLES.includes(user?.roleId);

  /*
   * The name to greet this person by, most specific first.
   *
   * 1. What the portal loaded — a student's registered full name, a teacher's
   *    employee record. Richest, but arrives late.
   * 2. `users.full_name` from the token payload. Always present from the first
   *    paint for any account that has been named.
   * 3. Nothing. The greeting says "there", which is honest.
   *
   * Deliberately no placeholder like "User" in this chain: a fallback that
   * reads like a name cannot be told apart from one, and every consumer
   * downstream then treats it as real.
   */
  const userName = (nameOverride || user?.name || '').trim() || null;

  // Just the first name. "Hi Ayeza Fatima Khan" is a form letter.
  const firstName = userName ? userName.split(/\s+/)[0] : null;

  /*
   * Everything account-shaped is dropped the moment the account changes.
   *
   * Keyed on userId rather than on the user object, which is replaced on every
   * profile edit and would otherwise wipe the thread mid-conversation. Signing
   * out sets it to undefined, which is a change like any other and clears just
   * the same — the greeting bug needed only ONE stale value to survive one
   * sign-out.
   *
   * This is now the ONLY thing that starts a new conversation, since the
   * manual "start over" control has been removed. That is the intended
   * lifetime: one thread per signed-in session.
   */
  const lastUserId = useRef(user?.userId);

  useEffect(() => {
    if (lastUserId.current === user?.userId) return;
    lastUserId.current = user?.userId;

    abortRef.current?.abort();
    setNameOverride(null);
    setConversationId(null);
    setMessages([]);
    setSuggestions([]);
    setBusy(false);
    setIsOpen(false);
  }, [user?.userId]);

  /*
   * The greeting is seeded once, when the thread is empty and the role is
   * known.
   *
   * Not in useState's initialiser, because at first render `scope` may still
   * be null while auth rehydrates from localStorage — seeding there produced a
   * greeting for the "Institute" portal that then never corrected itself.
   *
   * `firstName` is deliberately absent from the dependency list. A student's
   * profile resolving a moment after sign-in refines it, and re-seeding on
   * that would discard a message the user had already sent. The guard on
   * `messages.length` makes this run exactly once per thread anyway.
   */
  useEffect(() => {
    if (!isAvailable || !scope || messages.length) return;
    setMessages([greetingFor(firstName, portal, scope)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable, scope, portal, messages.length]);

  /*
   * Opening prompts, from the server.
   *
   * TWO bugs lived in the version of this that shipped, and both made it look
   * alive while doing nothing:
   *
   *   1. It read `data.tools`, and the endpoint has never returned a `tools`
   *      key. The backend now returns `suggestions`.
   *   2. It destructured `({ data })` from the response. The shared client's
   *      get() resolves to the PARSED BODY, not to an axios-style envelope, so
   *      `data` was undefined regardless of what the server sent.
   *
   * Either one alone was enough to keep the chips from ever rendering once.
   * Fixing the key without fixing the envelope — which is what happened first —
   * changes nothing observable, which is exactly why it went unnoticed.
   */
  useEffect(() => {
    if (!isOpen || !isAvailable || suggestions.length) return;

    let cancelled = false;

    assistant.capabilities()
      .then((body) => {
        if (cancelled || !Array.isArray(body?.suggestions)) return;
        setSuggestions(body.suggestions.slice(0, 4));
      })
      .catch(() => { /* suggestions are a nicety; the input still works */ });

    return () => { cancelled = true; };
  }, [isOpen, isAvailable, suggestions.length]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  /**
   * Sends one question and appends the reply.
   *
   * Returns nothing: callers render from `messages`, so a caller that also
   * handled the result would be a second place for the transcript to live.
   */
  const send = useCallback(async (question) => {
    const text = String(question || '').trim();
    if (!text || busy) return;

    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);

    // Supersede an in-flight question rather than racing two answers into the
    // same thread.
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const result = await assistant.chat(text, {
        conversationId,

        /*
         * Sent for the transcript's benefit only — it labels which portal the
         * conversation happened in. The backend does NOT trust it for
         * authorisation or for role awareness; it resolves both from the token
         * in scope.service. A client-supplied role would be a client-supplied
         * permission.
         */
        portal,
        signal: abortRef.current.signal,
      });

      if (result.conversation_id) setConversationId(result.conversation_id);

      setMessages((m) => [...m, {
        role: 'bot',
        text: result.response?.text || 'No answer was returned.',
        response: result.response,

        /*
         * The backend has always returned this; nothing read it. When the
         * documentation index is down every answer is generated with zero
         * passages, and the reply reads exactly like a normal one — which is
         * how an outage went unnoticed and produced confident guesses.
         * Explicitly false only, so an older backend that omits the field is
         * not flagged.
         */
        unverified: result.retrieval_available === false,
      }]);

    } catch (error) {
      if (error.name === 'AbortError') return;

      // The backend's messages are written to be shown, so they are surfaced
      // as-is rather than replaced with a generic failure.
      setMessages((m) => [...m, {
        role: 'bot',
        text: error.message || 'The assistant could not answer just now.',
        failed: true,
      }]);

    } finally {
      setBusy(false);
    }
  }, [busy, conversationId, portal]);

  /*
   * Lets a portal offer a better display name than the account carries.
   *
   * NOT a way to set the role or the portal any more — those come from the
   * token. A header that passes `portal` is ignored, on purpose: the previous
   * design let a header assert an identity, and a header cannot know whether
   * the backend agrees.
   *
   * An empty or missing `userName` CLEARS the override rather than preserving
   * whatever was there before. That inversion is the actual bug fix: the old
   * `if (u) setUserName(u)` treated "not loaded yet" as "keep the last one",
   * and the last one belonged to somebody else.
   */
  const configure = useCallback(({ userName: supplied } = {}) => {
    setNameOverride((supplied || '').trim() || null);
  }, []);

  const value = useMemo(
    () => ({
      isOpen, open, close, toggle,
      portal, scope, roleLabel,
      userName, firstName, configure,
      messages, busy, send,
      suggestions,
      isAvailable,
    }),
    [isOpen, open, close, toggle, portal, scope, roleLabel, userName, firstName,
      configure, messages, busy, send, suggestions, isAvailable]
  );

  return <ChatbotContext.Provider value={value}>{children}</ChatbotContext.Provider>;
}

export function useChatbot() {
  const ctx = useContext(ChatbotContext);
  if (!ctx) throw new Error('useChatbot must be used within ChatbotProvider');
  return ctx;
}

export { ASSISTANT_ROLES, SCOPE_FOR_ROLE, PORTAL_FOR_SCOPE };
