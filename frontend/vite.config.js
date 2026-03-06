import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'charts': ['recharts'],
          'dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/accessibility'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
