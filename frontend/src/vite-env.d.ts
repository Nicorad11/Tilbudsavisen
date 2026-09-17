/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Fuld URL til API'et når frontend og backend ligger på hver sit domæne (fx Vercel + Render). */
  readonly VITE_API_URL?: string;
}
