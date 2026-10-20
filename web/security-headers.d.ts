// Types for security-headers.js (CommonJS, loaded by next.config.js).
type Env = Record<string, string | undefined>;
export function securityHeaders(env: Env): { key: string; value: string }[];
export function buildCsp(env: Env): string;
export const CSP_REPORT_PATH: string;
export const CSP_ENFORCE: boolean;
