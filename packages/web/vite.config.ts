import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Keeps the browser on one origin, so there is no CORS story locally. */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:4100',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Keep our own service worker; the plugin only injects the built file
      // list into it. Workbox's generated worker would decide caching policy
      // for us, and the one rule that matters here — never serve a cached
      // answer to "has she taken it?" — is ours to keep explicit.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // Registration is done by hand in main.tsx, production only.
      injectRegister: null,
      // public/manifest.webmanifest is richer than anything generated here.
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
      devOptions: {
        // A service worker in front of Vite's module graph serves stale code
        // after an edit; not worth it for the offline shell.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  // The service worker only registers in a production build, so `vite preview`
  // is the only way to exercise the installable app — it needs the API too.
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
});
