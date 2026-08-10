/*
 * Hero load-intro gate. The intro should play on every full page load — first
 * visit AND refresh — but NOT replay on client-side route changes back to `/`.
 *
 * An in-memory module flag is exactly that boundary: a real page reload
 * re-evaluates this module (flag resets → intro plays), while an in-app
 * navigation keeps the module loaded (flag persists → no replay). sessionStorage
 * was wrong here — it survives a refresh, so the intro never replayed on reload.
 * See docs/HERO_MOTION.md for how to disable the intro.
 */
let played = false;

/** True when the load intro should play: not yet played this page load, motion allowed. */
export function heroIntroPending(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return !played;
}

/** Mark the intro as played for this page load (reset by a real refresh/reload). */
export function markHeroIntroPlayed(): void {
  played = true;
}

/** Test-only: reset the in-memory flag (a real reload does this by re-evaluating the module). */
export function __resetHeroIntroForTests(): void {
  played = false;
}
