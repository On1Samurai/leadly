import { describe, expect, it } from 'vitest'
import { isAppUrl, navDecision } from '../src/main/app-url'

const FILE_APP = 'file:///C:/Program%20Files/Local%20Leads/resources/app.asar/out/renderer/index.html'
const DEV_APP = 'http://localhost:5173/'

describe('isAppUrl', () => {
  it('файл программы: тот же index.html с хешем и запросом', () => {
    expect(isAppUrl(FILE_APP, FILE_APP)).toBe(true)
    expect(isAppUrl(`${FILE_APP}#/base`, FILE_APP)).toBe(true)
    expect(isAppUrl(`${FILE_APP}?x=1`, FILE_APP)).toBe(true)
  })
  it('другой файл или сайт — не программа', () => {
    expect(isAppUrl('file:///C:/Users/me/Downloads/evil.html', FILE_APP)).toBe(false)
    expect(isAppUrl('https://www.openstreetmap.org/copyright', FILE_APP)).toBe(false)
    expect(isAppUrl('javascript:alert(1)', FILE_APP)).toBe(false)
    expect(isAppUrl('not a url', FILE_APP)).toBe(false)
  })
  it('dev: тот же origin', () => {
    expect(isAppUrl('http://localhost:5173/#/today', DEV_APP)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', DEV_APP)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', DEV_APP)).toBe(false)
  })
})

describe('navDecision', () => {
  it('своё — allow, http(s) — external, прочее — block', () => {
    expect(navDecision(`${FILE_APP}#/x`, FILE_APP)).toBe('allow')
    expect(navDecision('https://www.openstreetmap.org/copyright', FILE_APP)).toBe('external')
    expect(navDecision('http://leafletjs.com', FILE_APP)).toBe('external')
    expect(navDecision('file:///C:/Users/me/Downloads/photo.png', FILE_APP)).toBe('block')
    expect(navDecision('data:text/html,<b>x</b>', FILE_APP)).toBe('block')
  })
})
