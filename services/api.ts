declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      GEMINI_API_KEY?: string;
      API_KEY?: string;
    };
  }
}

const runtimeApiKey = (): string =>
  window.__RUNTIME_CONFIG__?.GEMINI_API_KEY ||
  window.__RUNTIME_CONFIG__?.API_KEY ||
  '';

const buildTimeApiKey = (): string =>
  process.env.GEMINI_API_KEY || process.env.API_KEY || '';

export const getApiKey = (): string => {
  const useCustomKey = localStorage.getItem('useCustomApiKey') === 'true';
  const runtime = runtimeApiKey();
  const builtIn = buildTimeApiKey();
  if (useCustomKey && (runtime || builtIn)) {
    return runtime || builtIn;
  }
  return runtime || builtIn;
};
