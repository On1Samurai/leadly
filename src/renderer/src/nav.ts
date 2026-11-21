import { createContext, useContext } from 'react'

export type Page = 'onboarding' | 'search' | 'base' | 'today' | 'demos' | 'demoEditor' | 'settings' | 'help'
export interface NavParams { cityId?: number; placeId?: number }
interface Nav { page: Page; params: NavParams; navigate: (p: Page, params?: NavParams) => void }
export const NavContext = createContext<Nav>({ page: 'search', params: {}, navigate: () => undefined })
export const useNav = (): Nav => useContext(NavContext)
