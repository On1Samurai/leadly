import { createContext, useContext } from 'react'

export type Page = 'onboarding' | 'search' | 'base' | 'today' | 'settings' | 'help'
export const NavContext = createContext<{ page: Page; navigate: (p: Page) => void }>({ page: 'search', navigate: () => undefined })
export const useNav = (): { page: Page; navigate: (p: Page) => void } => useContext(NavContext)
