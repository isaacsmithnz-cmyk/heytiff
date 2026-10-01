"use client";

export function PrintButton() {
  return (
    <button type="button" className="cerp-print" onClick={() => window.print()}>
      Print certificate
    </button>
  );
}
