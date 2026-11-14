import { describe, it, expect } from 'vitest'
import { haversineM, pointInPolygon } from '../src/main/core/geo'
import { makeGrid, cellIndexOf, orderCells, type CellStat } from '../src/main/core/grid'

const minsk = { south: 53.85, west: 27.40, north: 53.97, east: 27.70 }

describe('grid', () => {
  it('grid size for Minsk bbox', () => {
    const g = makeGrid(minsk, 1)
    expect(g.length).toBe(280)
    expect(Math.max(...g.map((c) => c.ix))).toBe(19)
    expect(Math.max(...g.map((c) => c.iy))).toBe(13)
  })

  it('grid clipped by polygon', () => {
    const tri = {
      type: 'Polygon' as const,
      coordinates: [[[27.40, 53.85], [27.70, 53.85], [27.40, 53.97], [27.40, 53.85]]],
    }
    const g = makeGrid(minsk, 1, tri)
    expect(g.length).toBeGreaterThan(0)
    expect(g.length).toBeLessThan(280)
    expect(g.find((c) => c.ix === 19 && c.iy === 13)).toBeUndefined()
    expect(g.find((c) => c.ix === 0 && c.iy === 0)).toBeDefined()
  })

  it('cellIndexOf matches makeGrid', () => {
    const c = makeGrid(minsk, 1).find((x) => x.ix === 3 && x.iy === 5)!
    const lat = (c.bbox.south + c.bbox.north) / 2
    const lon = (c.bbox.west + c.bbox.east) / 2
    expect(cellIndexOf(lat, lon, minsk, 1)).toEqual({ ix: 3, iy: 5 })
  })

  it('haversine 1 degree lat', () => {
    expect(Math.abs(haversineM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195)).toBeLessThan(50)
  })

  it('pointInPolygon handles holes and MultiPolygon', () => {
    const ring = (a: number, b: number) => [[a, a], [b, a], [b, b], [a, b], [a, a]]
    const donut = { type: 'Polygon' as const, coordinates: [ring(0, 10), ring(4, 6)] }
    expect(pointInPolygon(2, 2, donut)).toBe(true)
    expect(pointInPolygon(5, 5, donut)).toBe(false)
    const multi = { type: 'MultiPolygon' as const, coordinates: [[ring(0, 1)], [ring(20, 21)]] }
    expect(pointInPolygon(20.5, 20.5, multi)).toBe(true)
    expect(pointInPolygon(10, 10, multi)).toBe(false)
  })
})

describe('orderCells', () => {
  const cells: CellStat[] = [
    { id: 1, osmCount: 1, googleYield: 0 },
    { id: 2, osmCount: 5, googleYield: 5 },
    { id: 3, osmCount: 0, googleYield: 0 },
    { id: 4, osmCount: 3, googleYield: 0 },
    { id: 5, osmCount: 0, googleYield: 0 },
    { id: 6, osmCount: 2, googleYield: 0 },
    { id: 7, osmCount: 0, googleYield: 0 },
  ]
  it('orderCells dense first, every 5th random empty', () => {
    const r = orderCells(cells, 5, () => 0).map((c) => c.id)
    expect(r.slice(0, 4)).toEqual([2, 4, 6, 1])
    expect(r[4]).toBe(3)
    expect(r.length).toBe(7)
    expect(new Set(r).size).toBe(7)
  })
  it('orderCells no random', () => {
    const r = orderCells(cells, 0, () => 0).map((c) => c.id)
    expect(r).toEqual([2, 4, 6, 1, 3, 5, 7])
  })
})
