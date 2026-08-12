import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Register the service worker in production only.
 *
 * In dev it would sit in front of Vite's module graph and serve stale code
 * after an edit, which costs more time than offline support saves.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // A failed registration must not take the app down with it.
      console.warn('[pwa] service worker registration failed:', error);
    });
  });
}
