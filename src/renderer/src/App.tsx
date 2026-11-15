import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MissionStep } from '../../shared/mission'
import { MissionBar } from './components/MissionBar'
import { Sidebar } from './components/Sidebar'
import { NavContext, type NavParams, type Page } from './nav'
import { errText } from './lib'
import { Base } from './pages/Base'
import { Help } from './pages/Help'
import { Onboarding } from './pages/Onboarding'
import { Search } from './pages/Search'
import { Settings } from './pages/Settings'

const Soon = ({ title }: { title: string }): React.JSX.Element => (
  <main className="px-8 py-8">
    <h1 className="mb-2 text-2xl font-bold">{title}</h1>
    <p className="text-muted">Скоро</p>
  </main>
)

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page | null>(null)
  const [params, setParams] = useState<NavParams>({})
  const [mission, setMission] = useState<MissionStep>(1)
  const [err, setErr] = useState<string | null>(null)

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
  else if (!page) body = <div />
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
            {page === 'today' && <Soon title="Сегодня" />}
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
