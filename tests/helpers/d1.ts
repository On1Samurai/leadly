import Database from 'better-sqlite3'

export interface D1Stmt {
  bind(...a: unknown[]): D1Stmt
  run(): Promise<unknown>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}
export interface D1Like {
  prepare(sql: string): D1Stmt
  exec(sql: string): Promise<unknown>
}

export function fakeD1(): D1Like {
  const db = new Database(':memory:')
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...a) => stmt(sql, a),
    run: async () => db.prepare(sql).run(...args),
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...args) as T | undefined) ?? null
  })
  return { prepare: (sql) => stmt(sql), exec: async (sql) => db.exec(sql) }
}
