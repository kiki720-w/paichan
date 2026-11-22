/// <reference types="vite/client" />

declare module 'cloudflare:workers' {
 export const env: {DB:import('@cloudflare/workers-types/index.ts').D1Database};
}
