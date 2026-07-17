import { Chevron } from "@/components/logo";

export default function Home() {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen gap-8 bg-zinc-50 dark:bg-black">
      <div className="flex items-center gap-3">
        <Chevron size={44} gradient className="ht-draw" />
        <span className="text-4xl font-extrabold tracking-tight">
          <span className="text-[#0A0B10] dark:text-white">Hey</span>
          <span className="text-[#00A389]">Tiff</span>
        </span>
      </div>
      <div className="flex flex-col items-center gap-4">
        <a
          href="/auth/login?screen_hint=signup"
          className="px-4 py-2 text-sm font-medium text-white bg-black rounded-md dark:bg-zinc-50 dark:text-black"
        >
          Create account
        </a>
        <a
          href="/auth/login"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Sign in
        </a>
      </div>
      {/* Quiet staff door — HQ 404s for anyone not on the allowlist, so this
          stays low-key rather than secret. returnTo lands staff in /hq
          straight after auth instead of the default /dashboard. */}
      <a
        href="/auth/login?returnTo=/hq"
        className="absolute bottom-6 text-xs font-medium text-zinc-400 hover:text-[#00A389] dark:text-zinc-600 dark:hover:text-[#00E5C0] transition-colors"
      >
        Staff HQ →
      </a>
    </div>
  );
}
