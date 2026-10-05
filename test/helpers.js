import { expect, vi } from 'vitest'

export const DEKI_TOKEN_URL = 'https://cdn.libretexts.net/authenBrowser.json'

/** @param {unknown} body */
export const jsonResponse = (body, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })

/**
 * Import the bundle fresh and run its DOMContentLoaded handler directly, so
 * handlers from earlier imports don't fire again.
 */
export async function runMain() {
  /** @type {EventListener | undefined} */
  let onReady
  const add = document.addEventListener.bind(document)
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, opts) => {
    if (type === 'DOMContentLoaded') onReady = /** @type {EventListener} */ (listener)
    else add(type, listener, opts)
  })
  vi.resetModules()
  await import('../src/script.js')
  expect(onReady).toBeTypeOf('function')
  await onReady?.(new Event('DOMContentLoaded'))
}
