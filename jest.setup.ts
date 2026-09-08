import '@testing-library/jest-dom'

// jsdom has no PointerEvent; the studio canvas is pointer-driven. Extend
// MouseEvent so clientX/clientY/button survive fireEvent.pointer*.
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  // @ts-expect-error assigning the polyfill onto the jsdom window
  window.PointerEvent = PointerEventPolyfill
}

// jsdom lacks object-URL APIs; the plans pipeline uses them for thumbnails.
if (typeof window !== 'undefined' && !window.URL.createObjectURL) {
  window.URL.createObjectURL = () => `blob:jest-${Math.random().toString(36).slice(2)}`
  window.URL.revokeObjectURL = () => {}
}

// jsdom lacks TextEncoder/TextDecoder, which Node has had globally for years.
// The Anthropic SDK reaches for one at IMPORT time, so any suite that touches
// a module importing it dies on `TextEncoder is not defined` before a single
// test runs — even when the test never calls the API. Borrow Node's.
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require('node:util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder
}

// jsdom lacks ResizeObserver; the cockpit's sliding seg-window observes its
// active pane to keep the animated height in sync with content.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error assigning the stub onto the jsdom window
  window.ResizeObserver = ResizeObserverStub
}

/* THE `"use server"` ACTION MODULES THAT REACH TIFF, stubbed for every suite.

   These are imported at module scope by the client components that offer a
   scan panel (the fleet's renewal screen, the organisation's credential modal,
   the staff licence modal). Importing one for real pulls `@/lib/auth0` and
   `next/server` into jsdom, and the suite fails to LOAD — `ReferenceError:
   Request is not defined` — rather than failing a test. Any screen that
   merely CONTAINS one of these modals inherits that, which is how five
   unrelated staff-card suites broke at once.

   It sits here for the same reason the TextEncoder shim above does: the
   breakage is at import time and belongs to the environment, not to any one
   test's intent. A suite that genuinely wants the real module can
   `jest.unmock` it; nothing does today, because these are thin wrappers whose
   prompt-and-parse half is pure and tested directly (lib/fleet/readers,
   lib/org/cred-readers, lib/staff/licence-readers).

   A suite that wants to CONTROL what Tiff answers still mocks it locally —
   a local jest.mock wins over this one. */
jest.mock('@/app/actions/org-credential-ai', () => ({
  readOrgCredentialDocument: jest.fn(async () => ({ ok: false, reason: 'no-key' })),
}))
jest.mock('@/app/actions/staff-licence-ai', () => ({
  readStaffLicenceDocument: jest.fn(async () => ({ ok: false, reason: 'no-key' })),
}))
jest.mock('@/app/actions/work-rights-ai', () => ({
  readWorkRightsDocument: jest.fn(async () => ({ ok: false, reason: 'no-key' })),
}))

/* The uploader's browser half, for the same reason and by the same route: it
   imports `@/app/actions/documents` to ask for a signed slot, which is a
   `"use server"` module, and every scan panel imports the uploader. Its job is
   to PUT bytes at real storage, which no jsdom suite can do or wants to.

   The default answers "that upload didn't finish" — honest, and it means no
   test can accidentally proceed as though a file had landed. A suite that
   wants a successful upload mocks it locally and asserts on it, which is what
   the org and staff card suites already do. */
jest.mock('@/lib/documents/upload-client', () => ({
  uploadFile: jest.fn(async () => ({ ok: false, error: "That upload didn't finish." })),
}))
