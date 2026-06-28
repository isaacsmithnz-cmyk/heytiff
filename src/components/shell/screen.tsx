/* Renders a screen's HTML string as a direct child of .page (matching the original
   v3 DOM so height/flex chains resolve correctly). */
export function Screen({ html }: { html: string }) {
  return <div className="page in" dangerouslySetInnerHTML={{ __html: html }} />;
}
