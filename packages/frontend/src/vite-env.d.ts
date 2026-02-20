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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
