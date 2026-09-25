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

/* THE SWMS ACTIONS, for the same reason: the job card imports them at module
   scope to list a job's SWMS and open the wizard, and the job card is inside
   the board, the Home day band and the gallery. The defaults are the empty
   answers — no SWMS on the job, a wizard with nothing to open. The SWMS
   suites that test the real actions `jest.unmock` it. */
jest.mock('@/app/actions/swms', () => ({
  listSwmsForJob: jest.fn(async () => []),
  swmsWizardContext: jest.fn(async () => null),
  swmsPrevious: jest.fn(async () => null),
  approveSwmsLibrary: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  issueSwms: jest.fn(async () => ({ ok: false, problems: ['Not in a test.'] })),
  signOnSwms: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
}))

/* Filing a document on a job, for the same reason: the job card imports it
   at module scope for its Documents face's upload. The default refuses, so no
   suite proceeds as though a file had been filed; job-documents.test.ts tests
   the real one and `jest.unmock`s it. */
jest.mock('@/app/actions/job-documents', () => ({
  attachJobDocument: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  removeJobDocument: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
}))

/* Compliance on a job and sending its files, for the same reason: the job
   card imports them at module scope for its Documents face. The defaults are
   the empty answers — nothing on the job, and a viewer who may do nothing
   with it, so no suite sees a tick or a button it didn't ask for. A suite
   that wants them mocks them locally; job-compliance.test.ts tests the real
   module and `jest.unmock`s it. */
jest.mock('@/app/actions/job-compliance', () => ({
  listJobPapers: jest.fn(async () => null),
  readComplianceChoices: jest.fn(async () => null),
  addJobPapers: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  removeJobPaper: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  renewJobPaper: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  readEmailDraft: jest.fn(async () => null),
  emailJobDocuments: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
}))

/* Send to ServiceM8's two actions, for the same reason: the job card imports
   them, and every suite that renders it would otherwise reach for Auth0 and
   Supabase. Nothing offered, nothing sent, until a suite says otherwise. */
jest.mock('@/app/actions/job-sm8', () => ({
  readJobSm8: jest.fn(async () => null),
  sendJobDocumentsToServiceM8: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
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

/* Notes to ServiceM8 on the job card (two-way phase 2), for the same reason:
   the job card imports them at module scope for its diary and strip. The
   defaults offer nothing and send nothing — no states to poll, every press
   refused — so no suite sees a door it didn't ask for. job-note-sm8.test.ts
   tests the real module and `jest.unmock`s it. */
jest.mock('@/app/actions/job-note-sm8', () => ({
  replyToJobNote: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  sendJobNoteToServiceM8: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  takeBackJobNote: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  markJobNoteDone: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  undoJobNoteDone: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  confirmMySm8Link: jest.fn(async () => ({ ok: false, error: 'Not in a test.' })),
  readJobNoteStates: jest.fn(async () => null),
}))
