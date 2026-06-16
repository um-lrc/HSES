import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        {
          name: 'hses-runtime-config',
          transformIndexHtml: {
            order: 'pre',
            handler() {
              return [
                {
                  tag: 'script',
                  attrs: { id: 'hses-runtime-config' },
                  children: 'window.__RUNTIME_CONFIG__={"GEMINI_API_KEY":"","API_KEY":""};',
                  injectTo: 'head-prepend',
                },
                {
                  tag: 'script',
                  attrs: { src: './runtime-config.js', defer: '' },
                  injectTo: 'head-prepend',
                },
              ];
            },
          },
        },
        react(),
        tailwindcss(),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
