"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 12,
        background: "#f9fafb",
        border: "1px solid #f0f0f2",
      }}
    >
      <code
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 12,
          color: "#6b7280",
        }}
      >
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable */
          }
        }}
        style={{
          flex: "0 0 auto",
          padding: "6px 14px",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          color: copied ? "#00A389" : "#fff",
          background: copied ? "rgba(0,229,192,0.12)" : "#050505",
          border: copied ? "1px solid rgba(0,229,192,0.3)" : "1px solid #050505",
          transition: "all .2s",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
