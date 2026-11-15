import type { LicenseState } from '../../../shared/ipc'
import { LicenseForm } from '../components/LicenseForm'

export function Activation({ onActivated }: { onActivated: (s: LicenseState) => void }): React.JSX.Element {
  return (
    <main className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 px-8">
      <div>
        <h1 className="text-2xl font-bold">Активация</h1>
        <p className="mt-2 text-sm text-muted">Вставьте лицензионный ключ, который вам выдали, чтобы начать работу с Leadly.</p>
      </div>
      <LicenseForm onActivated={onActivated} />
    </main>
  )
}
