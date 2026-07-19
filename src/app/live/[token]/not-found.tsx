import "@/components/studio/studio.css";

/* An expired/revoked/mistyped live link. Deliberately says nothing about
   whether a design exists — the token either resolves or it doesn't. */

export default function LiveNotFound() {
  return (
    <div className="ds-live-404">
      <span className="ds-live-brand">HeyTiff</span>
      <h1>This link is no longer active</h1>
      <p>Ask whoever sent it for a fresh one — links can be turned off at any
        time from the design&apos;s Summary.</p>
    </div>
  );
}
