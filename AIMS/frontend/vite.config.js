import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  /*
   * `@/` -> src. Required by shadcn/21st.dev components, which import each
   * other and the `cn` helper by that path. Mirrored in jsconfig.json so the
   * editor resolves it too — Vite alone fixes the build and leaves every
   * import underlined in the IDE.
   */
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  /*
   * No dev proxy.
   *
   * There was one here sending `/api/ai` to api.sambanova.ai. Nothing in the
   * product uses that provider any more — the live AI features are the Node
   * ones under /api/chatbot and /api/analytics, which the browser calls
   * directly at VITE_API_BASE_URL.
   *
   * The only caller left on `/api/ai` is the student dashboard's performance
   * prediction panel, which is not implemented on the backend. With the proxy
   * gone it 404s against our own API and the panel stays hidden, instead of
   * quietly sending requests to a third party during development.
   */
})
