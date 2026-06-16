
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

if (!window.__RUNTIME_CONFIG__?.GEMINI_API_KEY && !window.__RUNTIME_CONFIG__?.API_KEY) {
  console.warn(
    'HSES: GEMINI_API_KEY is not set. Configure GEMINI_API_KEY in Portainer stack env vars, redeploy, then verify the inline script in page source or /runtime-config.js.'
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
