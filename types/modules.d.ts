// Ambient declarations for the dependencies that ship no types of their own.

declare module "ejs" {
  export function renderFile(
    path: string,
    data: Record<string, unknown>,
    callback: (error: Error | null, html?: string) => void
  ): void;
  export function render(template: string, data?: Record<string, unknown>): string;
  const ejs: { renderFile: typeof renderFile; render: typeof render };
  export default ejs;
}

declare module "request" {
  interface RequestOptions {
    url: string;
    json?: unknown;
    followAllRedirects?: boolean;
    timeout?: number;
  }
  const request: {
    post(options: RequestOptions, callback: (error: unknown) => void): void;
  };
  export default request;
}

declare module "qrious/dist/qrious.min.js";
