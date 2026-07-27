import { PageSkeleton } from "@/components/shell/page-skeleton";

/* Its own boundary, below /dashboard/loading.tsx, because this segment reads
   `params` — a dynamic route parameter is runtime data, so the page suspends
   at its own entry point and needs a fallback there. */
export default function Loading() {
  return <PageSkeleton />;
}
