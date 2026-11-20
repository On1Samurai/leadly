export const WORKER_VERSION: string
export const SCHEMA_SQL: string
declare const worker: { fetch(request: Request, env: { DB: any; SECRET: string }): Promise<Response> }
export default worker
