import { useEffect } from 'react'

/** Esc закрывает оверлей и не доходит до панели карточки. */
export function useEsc(onClose: () => void): void {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
}

/** Диалог поверх панели карточки (data-overlay гасит её клавиши). */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  useEsc(onClose)
  return (
    <div data-overlay className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <h3 className="text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  )
}
