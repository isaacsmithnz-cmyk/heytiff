import "./studio.css";

/* What the Design Studio's route holds while its page is still on its way
   (app/dashboard/studio/loading.tsx): the dark, and nothing on it.

   The dashboard's own fallback is the shell's light PageSkeleton, and the
   Studio's start screen is dark: clicking Design used to paint a white
   skeleton on the light well, then snap to black when the page arrived. A
   dark skeleton was tried next and was wrong the other way — grey bars on a
   black screen is a loading state, and this is the one screen in the app
   that makes an entrance. So the fallback is only the `.dstudio` root, which
   is what studio.css keys the well's dissolve and the frame's dot grid on:
   the well goes dark ON THE CLICK, and the start screen then rises into it
   (`.ds-home-stack`'s entrance, studio.css). Static, no hooks, so the route
   can prerender it. */
export function StudioHold() {
  return (
    <div className="page in" aria-busy="true" aria-live="polite">
      <div className="dstudio">
        <div className="ds-home">
          <span className="ds-sr" role="status">
            Opening the Design Studio
          </span>
        </div>
      </div>
    </div>
  );
}
