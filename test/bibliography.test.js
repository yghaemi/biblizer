import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEKI_TOKEN_URL, jsonResponse, runMain } from './helpers.js'

const API_HOST = 'https://api.test'

// Book 1
// ├── Chapter 2
// │   ├── Page 3  refs: A
// │   └── Page 4  refs: B, C
// └── Chapter 5   refs: D
const toc = {
  id: '1', title: 'Book', refs: [], children: [
    { id: '2', title: 'Chapter', refs: [], children: [
      { id: '3', title: 'Page 3', refs: ['A'], children: [] },
      { id: '4', title: 'Page 4', refs: ['B', 'C'], children: [] },
    ] },
    { id: '5', title: 'Chapter 5', refs: ['D'], children: [] },
  ],
}

const referenceItems = ['A', 'B', 'C', 'D'].map((key) => ({
  citationKey: key,
  entryType: 'misc',
  title: `Title ${key}`,
  author: `Author ${key}`,
  year: '2026',
}))

const groups = [
  { groupID: 'g1', pageIds: ['3', '4'], targetPageId: '4' },
  { groupID: 'g2', pageIds: ['5'], targetPageId: '5' },
]

/**
 * Stub the network for `pageID` with the given page-info fields.
 * @param {string} pageID
 * @param {Record<string, unknown>} pageInfo
 */
function stubApi(pageID, pageInfo) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    url = String(url)
    if (url === DEKI_TOKEN_URL) return jsonResponse({ dev: 'token' })
    if (url.includes('/@api/deki/pages/')) return jsonResponse({ '@id': pageID })
    if (url.includes('/page/')) {
      return jsonResponse({
        err: false,
        data: {
          projectID: 'p1',
          lastUpdatedAt: '2026-10-05T00:00:00.000Z',
          format: 'IEEE',
          backmatterPageID: '9',
          backmatterReferenceList: [],
          selectedList: [],
          ...pageInfo,
        },
      })
    }
    if (url.includes('/projects/')) return jsonResponse({ err: false, data: { referenceItems, toc } })
    return jsonResponse({}, false)
  }))
}

/** @param {string} body  page content HTML */
function setPage(body) {
  document.body.innerHTML =
    `<div id="elm-main-content"><section class="mt-content-container">${body}</section></div>`
}

/** Bibliography entry ids rendered in `container`, in order. */
const entryIds = (/** @type {Element|null} */ container) =>
  [...(container?.querySelectorAll('li[id^="ref-"]') ?? [])].map((li) => li.id)

const citationTexts = () =>
  [...document.querySelectorAll('.librecite')].map((el) => el.textContent)

describe('bibliography rendering', () => {
  beforeEach(() => {
    process.env.API_HOST = API_HOST
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('removes reference outputs that belong to other pages', async () => {
    setPage(
      '<p>Text \\librecite{A}</p>' +
        '<div class="reference-output" id="reference-output-99"></div>' +
        '<div class="reference-output" id="reference-output-3"></div>',
    )
    stubApi('3', { displayLocation: 'endOfPage' })

    await runMain()

    expect(document.getElementById('reference-output-99')).toBeNull()
    expect(entryIds(document.getElementById('reference-output-3'))).toEqual(['ref-A'])
  })

  describe('scenario 1: end of each page', () => {
    it('renders into the page\'s own container when present', async () => {
      setPage(
        '<p>Text \\librecite{A}</p>' +
          '<div class="reference-output" id="reference-output-3"></div><p>after</p>',
      )
      stubApi('3', { displayLocation: 'endOfPage' })

      await runMain()

      const container = document.getElementById('reference-output-3')
      expect(entryIds(container)).toEqual(['ref-A'])
      expect(container?.nextElementSibling?.textContent).toBe('after')
    })

    it('appends a container as the last child of #elm-main-content > section', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', { displayLocation: 'endOfPage' })

      await runMain()

      const section = document.querySelector('#elm-main-content > section')
      const last = section?.lastElementChild
      expect(last?.id).toBe('reference-output-3')
      expect(last?.className).toBe('reference-output')
      expect(entryIds(last ?? null)).toEqual(['ref-A'])
    })
  })

  describe('entry layout', () => {
    it('puts the number and the entry of numeric styles on one line', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', { displayLocation: 'endOfPage', format: 'IEEE' })

      await runMain()

      const li = document.getElementById('ref-A')
      expect(li?.classList.contains('csl-flush')).toBe(true)
      expect(li?.querySelector(':scope > .csl-left-margin')?.textContent).toBe('[1]')
      expect(li?.querySelector(':scope > .csl-right-inline')?.textContent).toContain('Title A')
    })

    it('leaves author-date entries as plain text', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', { displayLocation: 'endOfPage', format: 'APA' })

      await runMain()

      expect(document.getElementById('ref-A')?.classList.contains('csl-flush')).toBe(false)
    })
  })

  describe('scenario 2: chapter group', () => {
    const chapterInfo = { displayLocation: 'endOfChapter', scope: { mode: 'CHAPTER', groups } }

    it('numbers in-text citations in the group\'s TOC order', async () => {
      // Page 3 alone would number B as [1]; in group g1 (A, B, C) it is [2].
      setPage('<p>Text \\librecite{B}</p>')
      stubApi('3', { ...chapterInfo, displayGroups: [] })

      await runMain()

      expect(citationTexts().at(-1)).toBe('[2]')
    })

    it('does not render on a page that is not the group target', async () => {
      setPage('<p>Text \\librecite{A}</p><div class="reference-output" id="reference-output-3"></div>')
      stubApi('3', { ...chapterInfo, displayGroups: [] })

      await runMain()

      expect(entryIds(document.getElementById('reference-output-3'))).toEqual([])
    })

    it('renders the whole group on the target page once its container appears', async () => {
      setPage('<p>Text \\librecite{C}</p>')
      stubApi('4', { ...chapterInfo, displayGroups: [groups[0]] })

      await runMain()

      expect(citationTexts().at(-1)).toBe('[3]')
      expect(document.querySelector('.reference-output')).toBeNull()

      const container = document.createElement('div')
      container.className = 'reference-output'
      container.id = 'reference-output-4'
      document.querySelector('section')?.appendChild(container)
      await new Promise((resolve) => setTimeout(resolve, 0)) // let the observer fire

      expect(entryIds(container)).toEqual(['ref-A', 'ref-B', 'ref-C'])
    })
  })

  describe('scenario 3: back matter', () => {
    const backmatterInfo = { displayLocation: 'backmatter', backmatterReferenceList: ['A', 'B', 'D'] }

    it('renders on the back matter page', async () => {
      setPage('<p>Back matter</p>')
      stubApi('9', backmatterInfo)

      await runMain()

      const last = document.querySelector('#elm-main-content > section')?.lastElementChild
      expect(last?.id).toBe('reference-output-9')
      expect(entryIds(last ?? null)).toEqual(['ref-A', 'ref-B', 'ref-D'])
    })

    it('does not render on other pages', async () => {
      setPage('<p>Text \\librecite{B}</p>')
      stubApi('4', backmatterInfo)

      await runMain()

      expect(document.querySelector('.reference-output')).toBeNull()
      expect(citationTexts().at(-1)).toBe('[2]')
    })
  })
})
