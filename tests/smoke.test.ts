import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import categoriesRaw from '../resources/data/categories.json?raw'
import type { Category } from '../src/shared/types'

describe('smoke', () => {
  it('better-sqlite3 открывает :memory: и выполняет select 1', () => {
    const db = new Database(':memory:')
    const row = db.prepare('select 1 as v').get() as { v: number }
    expect(row.v).toBe(1)
    db.close()
  })

  it('categories.json: у каждой категории есть id, title, query.ru, query.uk', () => {
    const categories = JSON.parse(categoriesRaw) as Category[]
    expect(categories).toHaveLength(16)
    for (const c of categories) {
      expect(c.id).toBeTruthy()
      expect(c.title).toBeTruthy()
      expect(c.query.ru).toBeTruthy()
      expect(c.query.uk).toBeTruthy()
    }
    expect(new Set(categories.map((c) => c.id)).size).toBe(16)
  })
})
