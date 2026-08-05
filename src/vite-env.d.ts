/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `dev` on the dev SWA (set via app settings). Missing on prod.
   * Consumed by <DevEnvironmentBanner /> to show the banner only on dev.
   */
  readonly VITE_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
