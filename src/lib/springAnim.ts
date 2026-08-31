/**
 * Per-letter "spring out of the ground" animation, fully parameterized so it can
 * be tuned live in the Animation Lab and then frozen as the final loading effect.
 *
 * Each letter starts sunk below its baseline, springs up past its resting spot
 * (overshoot), gives a quick side-to-side shake, then settles. Letters fire in a
 * RANDOM order but at a CONSTANT interval (`popInterval`), so one pops, then a
 * beat later another random one pops, and so on — an even cadence, random order.
 */

export interface SpringParams {
  /** How far below the baseline a letter starts, in px (springs up from here). */
  rise: number
  /** How far it overshoots ABOVE the baseline before settling, in px. */
  overshoot: number
  /** Starting scale (0–1); letters grow to full size as they rise. */
  startScale: number
  /** Peak scale at the top of the overshoot (a little squash-and-stretch). */
  peakScale: number
  /** Shake amplitude in degrees (rotation wiggle before it settles). */
  shake: number
  /** Share of letters (0–100%) that do the VIOLENT variant instead of a calm spring. */
  violentChance: number
  /** Violent-shake amplitude in degrees — a harsh rattle on the up AND the fall. */
  violence: number
  /** Number of floating dust particles kicked up per letter (0 = none). */
  dustCount: number
  /** How far the dust particles drift as they float and fade, in px. */
  dustFloat: number
  /** How many trailing dots ("…") to drop after the word (0 = none). */
  dotCount: number
  /** When the dots start, in ms, relative to when the LETTERS finish. Negative
   *  values bring them in earlier (during/before the letters); positive, later. */
  dotDelay: number
  /** Gap between each dot dropping, in ms (they land one after another). */
  dotStagger: number
  /** How high above the baseline each dot starts before rushing down, in px. */
  dotFall: number
  /** Impact strength when a dot lands: squash-and-bounce amount (0 = none). */
  dotImpact: number
  /** Duration of a single dot's fall + impact, in ms. */
  dotDuration: number
  /** Duration of a single letter's animation, in ms. */
  duration: number
  /** Even gap between one letter popping and the next, in ms (the pop rate). */
  popInterval: number
  /** Optional extra RANDOM delay per letter, 0..jitter ms (0 = perfectly even). */
  jitter: number
  /** Size of the little dust puff at the ground as a letter emerges, in px (0 = off). */
  groundEffect: number
  /** How long each word stays before the lab advances to the next, in ms. */
  wordInterval: number
  /** cubic-bezier control points for the spring easing (X values are clamped 0–1). */
  easing: [number, number, number, number]
}

export const DEFAULT_SPRING: SpringParams = {
  rise: 18,
  overshoot: 9,
  startScale: 0.72,
  peakScale: 1.12,
  shake: 7,
  violentChance: 30,
  violence: 24,
  dustCount: 4,
  dustFloat: 22,
  dotCount: 3,
  dotDelay: 0,
  dotStagger: 90,
  dotFall: 44,
  dotImpact: 0.5,
  dotDuration: 520,
  duration: 640,
  popInterval: 95,
  jitter: 0,
  groundEffect: 8,
  wordInterval: 1900,
  easing: [0.34, 1.56, 0.64, 1],
}

/** Build the WAAPI keyframes for one letter from the current params. */
export function springKeyframes(p: SpringParams): Keyframe[] {
  return [
    { offset: 0, opacity: 0, transform: `translateY(${p.rise}px) scale(${p.startScale}) rotate(0deg)` },
    { offset: 0.35, opacity: 1, transform: `translateY(${-p.overshoot}px) scale(${p.peakScale}) rotate(0deg)` },
    { offset: 0.55, opacity: 1, transform: `translateY(${p.overshoot * 0.35}px) scale(1) rotate(${-p.shake}deg)` },
    { offset: 0.7, opacity: 1, transform: `translateY(${-p.overshoot * 0.2}px) scale(1) rotate(${p.shake}deg)` },
    { offset: 0.85, opacity: 1, transform: `translateY(0) scale(1) rotate(${-p.shake * 0.4}deg)` },
    { offset: 1, opacity: 1, transform: 'translateY(0) scale(1) rotate(0deg)' },
  ]
}

/**
 * The VIOLENT variant: the letter bursts out of the ground, gives a tiny extra
 * jump, then rattles hard (a harsh rotate + jitter that persists through the
 * upswing AND the fall) before slamming back to the baseline and settling.
 */
export function violentKeyframes(p: SpringParams): Keyframe[] {
  const v = p.violence
  const j = 3 // small translational jitter, px
  return [
    { offset: 0, opacity: 0, transform: `translateY(${p.rise}px) scale(${p.startScale}) rotate(0deg)` },
    { offset: 0.14, opacity: 1, transform: `translateY(${-p.overshoot}px) scale(${p.peakScale}) rotate(${-v}deg)` },
    { offset: 0.24, opacity: 1, transform: `translateY(${-p.overshoot - 8}px) translateX(${j}px) rotate(${v}deg)` },
    { offset: 0.36, opacity: 1, transform: `translateY(${-p.overshoot * 0.4}px) translateX(${-j}px) rotate(${-v}deg)` },
    { offset: 0.46, opacity: 1, transform: `translateY(0px) translateX(${j}px) rotate(${v}deg)` },
    { offset: 0.56, opacity: 1, transform: `translateY(-4px) translateX(${-j}px) rotate(${-v * 0.8}deg)` },
    { offset: 0.66, opacity: 1, transform: `translateY(0px) translateX(${j * 0.8}px) rotate(${v * 0.7}deg)` },
    { offset: 0.76, opacity: 1, transform: `translateY(0px) translateX(${-j * 0.6}px) rotate(${-v * 0.5}deg)` },
    { offset: 0.86, opacity: 1, transform: `translateY(0px) translateX(${j * 0.4}px) rotate(${v * 0.3}deg)` },
    { offset: 0.94, opacity: 1, transform: `translateY(0px) rotate(${-v * 0.15}deg)` },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1) rotate(0deg)' },
  ]
}

/**
 * A trailing dot: rushes straight down from above (accelerating, ease-in), then
 * SLAMS the baseline with a squash-and-bounce whose strength is `dotImpact`.
 * Uses per-keyframe easing so the fall accelerates and the landing snaps.
 */
export function dotKeyframes(p: SpringParams): Keyframe[] {
  const imp = p.dotImpact
  const sx = (n: number) => Math.max(0.1, n).toFixed(3)
  return [
    {
      offset: 0,
      opacity: 0,
      transform: `translateY(${-p.dotFall}px) scale(1)`,
      easing: 'cubic-bezier(0.55, 0.06, 0.68, 0.19)',
    },
    {
      offset: 0.5,
      opacity: 1,
      transform: 'translateY(0px) scale(1)',
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    { offset: 0.63, opacity: 1, transform: `translateY(0px) scaleX(${sx(1 + imp)}) scaleY(${sx(1 - imp * 0.6)})` },
    { offset: 0.8, opacity: 1, transform: `translateY(${-imp * 7}px) scaleX(${sx(1 - imp * 0.15)}) scaleY(${sx(1 + imp * 0.15)})` },
    { offset: 1, opacity: 1, transform: 'translateY(0px) scale(1)' },
  ]
}

/**
 * cubic-bezier(...) string for the easing field. The X control points (1st and
 * 3rd numbers) MUST be within [0,1] or the browser rejects the whole value, so
 * they're clamped here — the Y points can be anything (that's what bounces).
 */
export function springEasing(p: SpringParams): string {
  const clampX = (n: number) => Math.min(1, Math.max(0, n))
  const [x1, y1, x2, y2] = p.easing
  return `cubic-bezier(${clampX(x1)},${y1},${clampX(x2)},${y2})`
}

/** localStorage key for tuned values, so they survive reloads and code edits. */
export const SPRING_STORAGE_KEY = 'dvs-spring-params'

/** Load saved params (merged over defaults, so new fields still get a value). */
export function loadSpringParams(): SpringParams {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SPRING_STORAGE_KEY) : null
    if (raw) return { ...DEFAULT_SPRING, ...(JSON.parse(raw) as Partial<SpringParams>) }
  } catch {
    /* corrupt or unavailable storage — fall back to defaults */
  }
  return DEFAULT_SPRING
}
