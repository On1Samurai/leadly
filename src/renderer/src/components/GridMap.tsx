import { useEffect, useMemo } from 'react'
import { MapContainer, Rectangle, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CellView } from '../../../shared/ipc'
import type { BBox } from '../../../shared/types'
import { cellStyle, topThreshold } from '../search-view'

const bounds = (b: BBox): L.LatLngBoundsExpression => [[b.south, b.west], [b.north, b.east]]

/** Подгоняет карту под bbox один раз на смену fitKey. */
function Fit({ box, fitKey }: { box: BBox | null; fitKey: string }): null {
  const map = useMap()
  useEffect(() => { if (box) map.fitBounds(bounds(box), { padding: [20, 20] }) }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export function GridMap({ cells, box, fitKey }: { cells: CellView[]; box: BBox | null; fitKey: string }): React.JSX.Element {
  const { max, top } = useMemo(() => {
    const counts = cells.map((c) => c.newCount)
    return { max: Math.max(0, ...counts), top: topThreshold(counts) }
  }, [cells])
  return (
    <MapContainer center={[53.9, 27.56]} zoom={5} className="h-full w-full rounded-card" zoomControl={true}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19} />
      <Fit box={box} fitKey={fitKey} />
      {cells.map((c) => (
        <Rectangle key={`${c.ix},${c.iy},${c.newCount}`} bounds={bounds(c.bbox)}
          pathOptions={{ fill: true, fillColor: '#ffffff', ...cellStyle(c.newCount, max, c.newCount > 0 && c.newCount >= top) }}>
          {c.newCount > 0 && <Tooltip permanent direction="center" className="cell-label">{`+${c.newCount}`}</Tooltip>}
        </Rectangle>
      ))}
    </MapContainer>
  )
}
