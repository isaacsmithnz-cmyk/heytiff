/* WHEN DESIGN'S KEYS STAND DOWN. Design listens for its shortcuts on the
   window (V select, B branch box, U the builder, Delete the selection…), so
   while a dialog is open over it, Tiff's above all, a key meant for the
   dialog must not reach the canvas: on 20 October a question typed while
   Tiff's box was not yet focused opened the system builder letter by
   letter. Any open modal dialog takes the keys. */
export function aDialogHasTheKeys(): boolean {
  return typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
}
