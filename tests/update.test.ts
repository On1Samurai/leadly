import { describe, expect, it } from 'vitest'
import { hasUpdate, reduceUpdate, updateErrorText } from '../src/shared/update'

describe('update reducer', () => {
  it('keeps version through progress/downloaded/error', () => {
    let s = reduceUpdate({ state: 'idle' }, { state: 'available', version: '1.2.0' })
    expect(s).toEqual({ state: 'available', version: '1.2.0' })
    s = reduceUpdate(s, { state: 'downloading', percent: 40 })
    expect(s).toMatchObject({ state: 'downloading', version: '1.2.0', percent: 40 })
    s = reduceUpdate(s, { state: 'error', message: 'net::ERR' })
    expect(s.version).toBe('1.2.0')
  })
  it('drops version on none/checking', () => {
    expect(reduceUpdate({ state: 'available', version: '1.2.0' }, { state: 'none' }).version).toBeUndefined()
  })
  it('hasUpdate only for available/downloaded', () => {
    expect(['idle', 'checking', 'none', 'downloading', 'error'].some((state) => hasUpdate({ state } as never))).toBe(false)
    expect(hasUpdate({ state: 'available' })).toBe(true)
    expect(hasUpdate({ state: 'downloaded' })).toBe(true)
  })
  it('error text is Russian', () => {
    expect(updateErrorText('net::ERR_INTERNET_DISCONNECTED')).toMatch(/интернет/)
    expect(updateErrorText('weird')).toMatch(/Не удалось/)
    expect(updateErrorText(undefined)).toMatch(/Не удалось/)
  })
})
