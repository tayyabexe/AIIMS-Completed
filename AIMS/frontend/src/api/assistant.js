// The AI assistant's API surface.
//
// Everything goes through the shared client, so the assistant uses the same
// session token, timeout and error shape as every other screen.
//
// Note what is NOT here: no model name, no API key, no prompt, no provider
// URL. The previous chatbot called an LLM provider directly from the browser
// with a key the user pasted into a settings panel, which put a credential in
// localStorage on every machine that opened it and meant the model was asked
// to enforce permissions it had no way to enforce. All of that now lives on
// the server, where the user's role actually decides what can be read.

import { get, post, del } from './client';

export const assistant = {
  /**
   * Ask a question.
   *
   * `conversationId` is optional — omitting it starts a new conversation and
   * the server returns the id it created.
   */
  chat: (message, { conversationId, portal, signal } = {}) =>
    post(
      '/api/chatbot/chat',
      { message, conversation_id: conversationId, portal },
      { signal }
    ),

  // What this account may ask about. Drives the suggestion chips, so a student
  // is never offered a prompt only an admin could run.
  capabilities: () => get('/api/chatbot/capabilities'),

  conversations: () => get('/api/chatbot/conversations'),
  transcript: (id) => get(`/api/chatbot/conversations/${id}`),
  remove: (id) => del(`/api/chatbot/conversations/${id}`),
};

export default assistant;
