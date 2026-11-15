import type { ButtonHTMLAttributes } from 'react'

export function Button({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }): React.JSX.Element {
  const v = variant === 'primary'
    ? 'bg-accent text-bg hover:bg-fg font-semibold'
    : 'border border-line text-fg hover:bg-surface'
  return <button type="button" {...p} className={`rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${v} ${className}`} />
}
