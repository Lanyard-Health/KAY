/// <reference types="vite/client" />

declare module 'qrcode' {
  interface QRCodeOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
  function toDataURL(text: string, options?: QRCodeOptions): Promise<string>;
  export default { toDataURL };
}

interface ImportMetaEnv {
  readonly VITE_DEV_AUTH_BYPASS: string;
  readonly VITE_API_URL: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  // 'staging' | 'production' | 'development'. Drives the TEST banner + the
  // beta "Report a bug" widget (both staging-only).
  readonly VITE_ENVIRONMENT: string;
  // Build commit SHA, surfaced in bug reports for context. Optional.
  readonly VITE_APP_COMMIT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
