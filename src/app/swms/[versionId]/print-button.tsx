"use client";

export function PrintButton() {
  return (
    <button type="button" className="swd-print" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
