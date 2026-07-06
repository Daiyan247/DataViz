import { useEffect, useState } from 'react'

/**
 * Tracks the system color scheme so chart series colors can be chosen per theme.
 * (Recharts paints SVG attributes that don't resolve CSS variables reliably, so
 * the palette is selected in JS — see `src/lib/palette.ts`.)
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return dark
}
