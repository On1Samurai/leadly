import type { BBox } from '../../shared/types'
import { pointInPolygon, type GeoPolygon, type GeoMultiPolygon } from './geo'

export interface GridCell { ix: number; iy: number; bbox: BBox }
export interface CellStat { id: number; osmCount: number; googleYield: number }

const M_PER_DEG = 111320

function steps(bbox: BBox, sizeKm: number) {
  const midLat = (bbox.south + bbox.north) / 2
  const dLat = (sizeKm * 1000) / M_PER_DEG
  const dLon = (sizeKm * 1000) / (M_PER_DEG * Math.cos((midLat * Math.PI) / 180))
  const nx = Math.max(1, Math.ceil((bbox.east - bbox.west) / dLon - 1e-9))
  const ny = Math.max(1, Math.ceil((bbox.north - bbox.south) / dLat - 1e-9))
  return { dLat, dLon, nx, ny }
}

/** Число квадратов сетки без её построения. */
export function cellCount(bbox: BBox, sizeKm: number): number {
  const { nx, ny } = steps(bbox, sizeKm)
  return nx * ny
}

export function makeGrid(bbox: BBox, sizeKm: number, polygon?: GeoPolygon | GeoMultiPolygon): GridCell[] {
  const { dLat, dLon, nx, ny } = steps(bbox, sizeKm)
  const cells: GridCell[] = []
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const b: BBox = {
        south: bbox.south + iy * dLat,
        west: bbox.west + ix * dLon,
        north: Math.min(bbox.north, bbox.south + (iy + 1) * dLat),
        east: Math.min(bbox.east, bbox.west + (ix + 1) * dLon),
      }
      if (polygon) {
        const pts: [number, number][] = [
          [(b.south + b.north) / 2, (b.west + b.east) / 2],
          [b.south, b.west], [b.south, b.east], [b.north, b.west], [b.north, b.east],
        ]
        if (!pts.some(([la, lo]) => pointInPolygon(la, lo, polygon))) continue
      }
      cells.push({ ix, iy, bbox: b })
    }
  }
  return cells
}

export function cellIndexOf(lat: number, lon: number, bbox: BBox, sizeKm: number): { ix: number; iy: number } {
  const { dLat, dLon, nx, ny } = steps(bbox, sizeKm)
  const ix = Math.min(nx - 1, Math.max(0, Math.floor((lon - bbox.west) / dLon)))
  const iy = Math.min(ny - 1, Math.max(0, Math.floor((lat - bbox.south) / dLat)))
  return { ix, iy }
}

/** Плотные первыми; каждая randomEvery-я позиция — случайный пустой квадрат (random=true). */
export function orderCellsFlagged(
  cells: CellStat[], randomEvery: number, rng: () => number
): { cell: CellStat; random: boolean }[] {
  const dens = (c: CellStat) => c.osmCount + c.googleYield
  const rest = [...cells].sort((a, b) => dens(b) - dens(a)) // стабильная
  const out: { cell: CellStat; random: boolean }[] = []
  const total = rest.length
  while (out.length < total) {
    const pos = out.length + 1
    if (randomEvery > 0 && pos % randomEvery === 0) {
      const empties = rest.filter((c) => dens(c) === 0)
      if (empties.length) {
        const pick = empties[Math.min(empties.length - 1, Math.floor(rng() * empties.length))]
        rest.splice(rest.indexOf(pick), 1)
        out.push({ cell: pick, random: true })
        continue
      }
    }
    out.push({ cell: rest.shift()!, random: false })
  }
  return out
}

export function orderCells(cells: CellStat[], randomEvery: number, rng: () => number): CellStat[] {
  return orderCellsFlagged(cells, randomEvery, rng).map((x) => x.cell)
}
