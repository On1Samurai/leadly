const R = 6371008.8

/** Расстояние между точками по большому кругу, метры. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface GeoPolygon { type: 'Polygon'; coordinates: number[][][] }
export interface GeoMultiPolygon { type: 'MultiPolygon'; coordinates: number[][][][] }

function inRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygonRings(lat: number, lon: number, rings: number[][][]): boolean {
  if (!rings.length || !inRing(lat, lon, rings[0])) return false
  return !rings.slice(1).some((h) => inRing(lat, lon, h))
}

/** Ray casting по GeoJSON ([lon, lat]); дырки исключают. */
export function pointInPolygon(lat: number, lon: number, geo: GeoPolygon | GeoMultiPolygon): boolean {
  if (geo.type === 'Polygon') return inPolygonRings(lat, lon, geo.coordinates)
  return geo.coordinates.some((p) => inPolygonRings(lat, lon, p))
}
