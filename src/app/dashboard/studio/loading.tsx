import { StudioSkeleton } from "@/components/studio/studio-skeleton";

/* Its own boundary, below /dashboard/loading.tsx, because that one is the
   shell's LIGHT skeleton and this screen is dark: on a click from any other
   page the nearest fallback under the shared layout is what paints, and it
   was a white page that snapped to black when the Studio arrived. This
   fallback is the start screen's own dark shapes, so the well dissolves on
   the click and the page only fills them in. */
export default function Loading() {
  return <StudioSkeleton />;
}
