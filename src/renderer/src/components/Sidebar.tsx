import { hasUpdate } from '../../../shared/update'
import { useNav, type Page } from '../nav'
import { useUpdate } from '../useUpdate'

const ITEMS: { page: Page; label: string }[] = [
  { page: 'search', label: 'Поиск' },
  { page: 'base', label: 'База' },
  { page: 'today', label: 'Сегодня' },
  { page: 'settings', label: 'Настройки' },
  { page: 'help', label: 'Помощь' }
]

export function Sidebar(): React.JSX.Element {
  const { page, navigate } = useNav()
  const upd = useUpdate()
  return (
    <nav aria-label="Разделы" className="flex w-52 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3">
      <div className="px-3 pt-2 text-lg font-bold">Leadly</div>
      {hasUpdate(upd)
        ? (
          <button type="button" onClick={() => navigate('settings')} className="mb-4 flex cursor-pointer items-center gap-2 px-3 text-left text-xs text-muted hover:text-fg">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-fg" />Есть обновление
          </button>)
        : <div className="mb-4" />}
      {ITEMS.map((it) => (
        <button key={it.page} type="button" onClick={() => navigate(it.page)} aria-current={page === it.page ? 'page' : undefined}
          className={`cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors ${page === it.page ? 'bg-accent font-semibold text-bg' : 'text-muted hover:text-fg'}`}>
          {it.label}
        </button>
      ))}
    </nav>
  )
}
