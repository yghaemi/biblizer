import { readFileSync } from 'fs'
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
 * @param {Record<string, unknown>} [styleResponse]  body for GET /styles/:id
 */
function stubApi(pageID, pageInfo, styleResponse) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    url = String(url)
    if (url === DEKI_TOKEN_URL) return jsonResponse({ dev: 'token' })
    if (url.includes('/@api/deki/pages/')) return jsonResponse({ '@id': pageID })
    if (url.includes('/styles/')) {
      return styleResponse
        ? jsonResponse({ err: false, data: styleResponse })
        : jsonResponse({}, false)
    }
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

    it('renders the group on a non-target page that has its own container', async () => {
      setPage('<p>Text \\librecite{A}</p><div class="reference-output" id="reference-output-3"></div>')
      stubApi('3', { ...chapterInfo, displayGroups: [] })

      await runMain()

      expect(entryIds(document.getElementById('reference-output-3'))).toEqual(['ref-A', 'ref-B', 'ref-C'])
    })

    it('renders the group when no targetPageId is set but the container exists', async () => {
      const untargeted = groups.map(({ targetPageId, ...g }) => g)
      setPage('<p>Text \\librecite{A}</p><div class="reference-output" id="reference-output-3"></div>')
      stubApi('3', { displayLocation: 'endOfChapter', scope: { mode: 'CHAPTER', groups: untargeted }, displayGroups: [] })

      await runMain()

      expect(entryIds(document.getElementById('reference-output-3'))).toEqual(['ref-A', 'ref-B', 'ref-C'])
    })

    it('does not create a container on a non-target page', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', { ...chapterInfo, displayGroups: [] })

      await runMain()

      expect(document.querySelector('.reference-output')).toBeNull()
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

  describe('footnotes', () => {
    const footnotes = () => [...document.querySelectorAll('.librecite-footnotes li')]

    it('turns citations into numbered notes listed before the bibliography', async () => {
      setPage('<p>One \\librecite{A} two \\librecite{B,C}</p>')
      stubApi('3', { displayLocation: 'endOfPage', citationPlacement: 'footnote' })

      await runMain()

      const markers = [...document.querySelectorAll('.librecite-fn')]
      expect(markers.map((el) => el.textContent)).toEqual(['1', '2'])
      expect(markers.every((el) => el.tagName === 'SUP')).toBe(true)
      expect(footnotes().map((li) => li.id)).toEqual(['librecite-fn-1', 'librecite-fn-2'])
      // One control per note: the link, not a focusable wrapper around it.
      expect(markers.every((el) => !el.hasAttribute('tabindex') && !el.hasAttribute('role'))).toBe(true)
      expect(markers[0].querySelector('a')?.getAttribute('href')).toBe('#librecite-fn-1')
      expect(footnotes()[0].querySelector('.fn-back')?.getAttribute('href')).toBe('#librecite-fnref-1')
      expect(footnotes()[0].textContent).toContain('Title A')
      // A numeric style's own "[1]" label is not repeated inside the note.
      expect(footnotes()[0].textContent).not.toContain('[1]')
      expect(footnotes()[1].textContent).toContain('Title B')
      expect(footnotes()[1].textContent).toContain('Title C')
      const section = document.getElementById('footnotes-3')
      expect(section?.nextElementSibling?.id).toBe('reference-output-3')
      expect(entryIds(document.getElementById('reference-output-3'))).toEqual(['ref-A', 'ref-B', 'ref-C'])
    })

    it('does not make footnotes of the hidden scope markers', async () => {
      setPage('<p>Text \\librecite{B}</p>')
      stubApi('3', {
        displayLocation: 'endOfChapter',
        citationPlacement: 'footnote',
        scope: { mode: 'CHAPTER', groups },
        displayGroups: [],
      })

      await runMain()

      expect(footnotes()).toHaveLength(1)
      expect(footnotes()[0].textContent).toContain('Title B')
    })

    it('leaves citations in the text by default', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', { displayLocation: 'endOfPage' })

      await runMain()

      expect(document.querySelector('.librecite-fn')).toBeNull()
      expect(document.querySelector('.librecite-footnotes')).toBeNull()
      expect(citationTexts().at(-1)).toBe('[1]')
    })
  })

  describe('references assigned without a citation', () => {
    it('lists them last in the chapter group\'s bibliography', async () => {
      const group = { ...groups[0], extraRefKeys: ['D'] }
      setPage('<p>Text \\librecite{C}</p><div class="reference-output" id="reference-output-4"></div>')
      stubApi('4', {
        displayLocation: 'endOfChapter',
        scope: { mode: 'CHAPTER', groups: [group, groups[1]] },
        displayGroups: [group],
      })

      await runMain()

      // D follows the group's cited references, so their numbers don't shift.
      expect(citationTexts().at(-1)).toBe('[3]')
      expect(entryIds(document.getElementById('reference-output-4'))).toEqual(['ref-A', 'ref-B', 'ref-C', 'ref-D'])
    })

    it('lists them after the page\'s own citations at the end of a page', async () => {
      setPage('<p>Text \\librecite{B}</p>')
      stubApi('3', {
        displayLocation: 'endOfPage',
        scope: {
          mode: 'PAGE',
          groups: [{ groupID: 'p3', pageIds: ['3'], targetPageId: '3', extraRefKeys: ['D'] }],
        },
      })

      await runMain()

      // The page's own citation keeps [1]; D's hidden marker comes after it.
      expect(citationTexts()[0]).toBe('[1]')
      expect(entryIds(document.getElementById('reference-output-3'))).toEqual(['ref-B', 'ref-D'])
    })
  })

  describe('custom styles', () => {
    const authorDate = readFileSync('src/csl/chicago-author-date.csl', 'utf8')
    const customStyle = { id: 'my-style', builtin: false, styleClass: 'in-text', updatedAt: '2026-11-01T00:00:00.000Z' }
    const customInfo = { format: 'my-style', style: customStyle, displayLocation: 'endOfPage' }
    const cslResponse = (xml) => ({ styleID: 'my-style', cslXml: xml, updatedAt: customStyle.updatedAt })
    const fetchedStyle = () =>
      /** @type {import('vitest').Mock} */ (fetch).mock.calls.filter(([url]) => String(url).includes('/styles/my-style'))

    it('fetches the CSL and renders with it', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', customInfo, cslResponse(authorDate))

      await runMain()

      expect(fetchedStyle()).toHaveLength(1)
      // Author-date, not the numeric default a failed lookup would give.
      expect(citationTexts().at(-1)).toContain('2026')
      expect(citationTexts().at(-1)).not.toBe('[1]')
      expect(entryIds(document.getElementById('reference-output-3'))).toEqual(['ref-A'])
    })

    it('reuses its cached copy until the style changes', async () => {
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', customInfo, cslResponse(authorDate))
      await runMain()

      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', customInfo, cslResponse(authorDate))
      await runMain()
      expect(fetchedStyle()).toHaveLength(0)

      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', { ...customInfo, style: { ...customStyle, updatedAt: '2026-11-02T00:00:00.000Z' } }, cslResponse(authorDate))
      await runMain()
      expect(fetchedStyle()).toHaveLength(1)
    })

    it('renders a note-class style as footnotes', async () => {
      const noteStyle = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0" default-locale="en-US">
  <info><id>http://example.com/styles/my-style</id><title>My Note Style</title><updated>2026-01-01T00:00:00+00:00</updated></info>
  <citation><layout delimiter="; "><text variable="title"/></layout></citation>
  <bibliography><layout><text variable="title"/></layout></bibliography>
</style>`
      // A fresh id: citeproc's style registry outlives the module reset.
      const noteInfo = {
        ...customInfo,
        format: 'my-note',
        style: { ...customStyle, id: 'my-note', styleClass: 'note' },
      }
      setPage('<p>One \\librecite{A} two \\librecite{B}</p>')
      stubApi('3', noteInfo, cslResponse(noteStyle))

      await runMain()

      const notes = [...document.querySelectorAll('.librecite-footnotes li')]
      expect(notes.map((li) => li.textContent)).toEqual([
        expect.stringContaining('Title A'),
        expect.stringContaining('Title B'),
      ])
      expect(document.querySelectorAll('.librecite-fn')).toHaveLength(2)
    })

    it('falls back to the default style when the CSL cannot be fetched', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      setPage('<p>Text \\librecite{A}</p>')
      stubApi('3', customInfo)

      await runMain()

      expect(warn).toHaveBeenCalled()
      expect(citationTexts().at(-1)).toBe('[1]')
    })
  })
})
