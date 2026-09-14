import { PageSkeleton } from "@/components/shell/page-skeleton";

/* The Data Library is a light page under a dark route: without a boundary of
   its own it would inherit ../loading.tsx, the Studio's dark start-screen
   skeleton, and flash black on the way to a white table. The shell's own
   light fallback is the right shape here. */
export default function Loading() {
  return <PageSkeleton />;
}
