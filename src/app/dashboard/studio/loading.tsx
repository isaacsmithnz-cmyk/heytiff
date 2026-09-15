import { StudioHold } from "@/components/studio/studio-hold";

/* Its own boundary, below /dashboard/loading.tsx, because that one is the
   shell's LIGHT skeleton and this screen is dark: on a click from any other
   page the nearest fallback under the shared layout is what paints, and it
   was a white page that snapped to black when the Studio arrived. This
   fallback is the dark alone — no skeleton — so the well dissolves on the
   click and the start screen makes its entrance into it. */
export default function Loading() {
  return <StudioHold />;
}
