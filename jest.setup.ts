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
