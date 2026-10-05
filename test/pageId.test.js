import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEKI_TOKEN_URL, jsonResponse, runMain } from './helpers.js'

const PAGE_ID = '10655'
const LIBRARY = 'dev'
const API_HOST = 'localhost:5000'

/** URLs fetch() was called with, in order. */
const fetchedUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))

const pageInfoUrl = `${API_HOST}/api/v1/reference/page/${PAGE_ID}/library/${LIBRARY}`

describe(`pageID resolution (page ${PAGE_ID}, library ${LIBRARY})`, () => {
  beforeEach(() => {
    process.env.API_HOST = API_HOST
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('uses the page id returned by the Deki API for the current URL', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === DEKI_TOKEN_URL) return jsonResponse({ [LIBRARY]: 'dev-token' })
      if (String(url).includes('/@api/deki/pages/')) return jsonResponse({ '@id': Number(PAGE_ID) })
      return jsonResponse({}, false) // page-info request: stop main() here
    }))

    await runMain()

    const [tokenCall, dekiCall, pageInfoCall] = vi.mocked(fetch).mock.calls
    expect(tokenCall[0]).toBe(DEKI_TOKEN_URL)
    expect(dekiCall[0]).toBe(
      `https://${LIBRARY}.libretexts.org/@api/deki/pages/=` +
        encodeURIComponent(encodeURIComponent('Sandboxes/test/Test_Page')) +
        '?dream.out.format=json',
    )
    expect(dekiCall[1]?.headers).toMatchObject({ 'x-deki-token': 'dev-token' })
    expect(pageInfoCall[0]).toBe(pageInfoUrl)
  })

  it('stops without requesting references when the Deki lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === DEKI_TOKEN_URL) return jsonResponse({}) // no token for "dev"
      return jsonResponse({}, false)
    }))

    await runMain()

    expect(console.error).toHaveBeenCalledWith('pageID not found:', expect.any(Error))
    expect(fetchedUrls()).toEqual([DEKI_TOKEN_URL])
  })
})
