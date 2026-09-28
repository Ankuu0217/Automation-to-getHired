/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API origin override (defaults to same-origin /api/v1). */
  readonly VITE_API_URL?: string;
  /** Support/privacy contact shown on /privacy. */
  readonly VITE_CONTACT_EMAIL?: string;
}
