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
