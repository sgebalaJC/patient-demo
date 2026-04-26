import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// `INCLUDE_SIM_MODE` is read from the build-time env (apphosting.yaml,
// shell, etc). Defaults to false so installer-emitted forks ship zero sim
// code — Vite tree-shakes `if (!INCLUDE_SIM_MODE) ...` branches. Demo
// fork sets `INCLUDE_SIM_MODE=true` in apphosting.yaml.
const INCLUDE_SIM_MODE = process.env.INCLUDE_SIM_MODE === 'true';

export default defineConfig({
  define: {
    __INCLUDE_SIM_MODE__: JSON.stringify(INCLUDE_SIM_MODE),
  },
  plugins: [react()],
  server: {
    port: 3001,
    host: '0.0.0.0',
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage', 'firebase/functions'],
          'vendor-ui': ['lucide-react', 'react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  }
})
