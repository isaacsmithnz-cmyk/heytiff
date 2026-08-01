"use client";

export function PrintButton() {
  return (
    <button className="ho-print" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
