import { describe, expect, it } from 'vitest'
import { extractLibrary } from '../src/script.js'

describe('extractLibrary', () => {
  it('resolves native LibreTexts hosts', () => {
    expect(extractLibrary('chem.libretexts.org')).toBe('chem')
    expect(extractLibrary('socialsci.libretexts.org')).toBe('socialsci')
    expect(extractLibrary('k12.libretexts.org')).toBe('k12')
  })

  it('resolves Google Translate proxy hosts', () => {
    expect(extractLibrary('chem-libretexts-org.translate.goog')).toBe('chem')
    expect(extractLibrary('socialsci-libretexts-org.translate.goog')).toBe('socialsci')
    expect(extractLibrary('espanol-libretexts-org.translate.goog')).toBe('espanol')
  })

  it('uses localhost / loopback as the dev library', () => {
    expect(extractLibrary('localhost')).toBe('dev')
    expect(extractLibrary('127.0.0.1')).toBe('dev')
  })

  it('falls back to dev when the host is not a known library', () => {
    expect(extractLibrary('translate.goog')).toBe('dev')
    expect(extractLibrary('example.com')).toBe('dev')
    expect(extractLibrary('')).toBe('dev')
  })
})
