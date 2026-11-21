export const WORKER_VERSION: string
export const SCHEMA_SQL: string
declare const worker: { fetch(request: Request, env: { DB: any; SECRET: string }, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> }
export default worker
