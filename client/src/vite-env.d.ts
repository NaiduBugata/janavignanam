/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Set to "true" only for the Capacitor Android production build. */
  readonly VITE_CAPACITOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
