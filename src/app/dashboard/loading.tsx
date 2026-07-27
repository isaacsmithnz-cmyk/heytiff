import { PageSkeleton } from "@/components/shell/page-skeleton";

/* Sits below the dashboard layout, so it is the Suspense boundary for every
   route under /dashboard — including the nested ones (timepay/leave,
   toolbox/*, team/[staff]). The layout itself is NOT re-rendered on a
   client navigation between siblings, so its own session/membership reads
   don't block the fallback from painting. */
export default function Loading() {
  return <PageSkeleton />;
}
