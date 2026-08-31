/**
 * Bridges the two ways this app describes "dark".
 *
 * shadcn/ui defines its dark tokens under a `.dark` class (`@custom-variant dark`),
 * which assumes something toggles that class. This app has always followed the OS
 * via `prefers-color-scheme` and has no theme switcher. So rather than duplicating
 * every dark token into a media query — two copies to keep in step, and the shadcn
 * CLI would overwrite one of them on its next run — the system preference drives
 * the class.
 *
 * Called from main.tsx BEFORE render so the first paint is already correct (adding
 * the class from a React effect would flash light-then-dark), and it keeps
 * listening so a mid-session OS change is picked up.
 */

const DARK = '(prefers-color-scheme: dark)'

function apply(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark)
}

/** Sync `<html class="dark">` with the OS preference. Returns an unsubscribe. */
export function followSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(DARK)
  apply(mq.matches)
  const onChange = (e: MediaQueryListEvent) => apply(e.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
