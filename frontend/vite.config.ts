import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Forward API calls to FastAPI so the browser sees a single origin (no CORS setup needed).
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
})
