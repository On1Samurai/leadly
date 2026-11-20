import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LicenseState } from '../../shared/ipc'
import type { MissionStep } from '../../shared/mission'
import { MissionBar } from './components/MissionBar'
import { Sidebar } from './components/Sidebar'
import { NavContext, type NavParams, type Page } from './nav'
import { errText } from './lib'
import { Activation } from './pages/Activation'
import { Base } from './pages/Base'
import { DemoEditor } from './pages/DemoEditor'
import { Demos } from './pages/Demos'
import { Help } from './pages/Help'
import { Onboarding } from './pages/Onboarding'
import { Search } from './pages/Search'
import { Today } from './pages/Today'
import { Settings } from './pages/Settings'

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page | null>(null)
  const [params, setParams] = useState<NavParams>({})
  const [mission, setMission] = useState<MissionStep>(1)
  const [err, setErr] = useState<string | null>(null)
  const [lic, setLic] = useState<LicenseState | null>(null)

  useEffect(() => { window.api.license.get().then(setLic).catch((e) => setErr(errText(e))) }, [])
  useEffect(() => {
    window.api.settings.get().then((s) => setPage(s.onboarded ? 'search' : 'onboarding')).catch((e) => setErr(errText(e)))
  }, [])
  // миссия обновляется при каждой смене экрана: шаги закрываются по данным БД
  useEffect(() => {
    if (page && page !== 'onboarding') window.api.mission.get().then(setMission).catch(() => undefined)
  }, [page])

  const navigate = useCallback((p: Page, pr?: NavParams) => { setParams(pr ?? {}); setPage(p) }, [])
  const ctx = useMemo(() => ({ page: page ?? 'search', params, navigate }), [page, params, navigate])

  let body: React.JSX.Element
  if (err) body = <p role="alert" className="p-8 text-danger">{err}</p>
  else if (!lic || !page) body = <div />
  else if (!lic.valid) body = <Activation onActivated={setLic} />
  else if (page === 'onboarding') body = <Onboarding onDone={() => navigate('search')} />
  else {
    body = (
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MissionBar step={mission} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {page === 'search' && <Search />}
            {page === 'base' && <Base key={params.cityId ?? 'all'} />}
            {page === 'today' && <Today />}
            {page === 'demos' && <Demos />}
            {page === 'demoEditor' && params.placeId !== undefined && <DemoEditor key={params.placeId} placeId={params.placeId} />}
            {page === 'settings' && <Settings />}
            {page === 'help' && <Help />}
          </div>
        </div>
      </div>
    )
  }
  return (
    <NavContext.Provider value={ctx}>
      <div className="h-full overflow-x-hidden">{body}</div>
      <div className="noise" aria-hidden="true" />
    </NavContext.Provider>
  )
}

export default App
