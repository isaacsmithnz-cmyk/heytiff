import type { ReactNode } from "react";
import type { Block, InlineNode, LetterBody } from "@/lib/letters/body";

/* A LETTER'S BODY ON PAPER — the stored document (lib/letters/body, already
   normalised) drawn as elements, never as HTML: what was typed is text on
   the page, whatever it says. No hooks, so the print page draws it too. */

function inlines(nodes: readonly InlineNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    let el: ReactNode = n.text;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "underline") el = <u>{el}</u>;
    }
    return <span key={i}>{el}</span>;
  });
}

function block(b: Block, key: number): ReactNode {
  switch (b.type) {
    case "paragraph":
      return (
        <p key={key} style={b.attrs?.textAlign ? { textAlign: b.attrs.textAlign } : undefined}>
          {inlines(b.content)}
        </p>
      );
    case "heading": {
      const style = b.attrs.textAlign ? { textAlign: b.attrs.textAlign } : undefined;
      return b.attrs.level === 3 ? (
        <h3 key={key} style={style}>
          {inlines(b.content)}
        </h3>
      ) : (
        <h2 key={key} style={style}>
          {inlines(b.content)}
        </h2>
      );
    }
    case "bulletList":
    case "orderedList": {
      const items = b.content.map((li, i) => <li key={i}>{li.content.map(block)}</li>);
      return b.type === "orderedList" ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "table":
      return (
        <table key={key}>
          <tbody>
            {b.content.map((row, r) => (
              <tr key={r}>
                {row.content.map((cell, c) =>
                  cell.type === "tableHeader" ? <th key={c}>{cell.content.map(block)}</th> : <td key={c}>{cell.content.map(block)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export function LetterBodyView({ body }: { body: LetterBody }) {
  return <>{body.content.map(block)}</>;
}
