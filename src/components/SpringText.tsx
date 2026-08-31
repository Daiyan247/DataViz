import { useEffect, useRef } from 'react'
import { dotKeyframes, springEasing, springKeyframes, violentKeyframes, type SpringParams } from '../lib/springAnim'

/**
 * Renders a word as individually-animated letters, each springing out of the
 * ground (see springAnim.ts). Letters pop in a RANDOM order but at a CONSTANT
 * interval, so the cadence is even while which letter is next stays surprising.
 * A random share of letters do a VIOLENT variant (burst out, tiny jump, harsh
 * rattle, fall back). As each letter emerges it kicks up floating dust particles.
 *
 * Trailing dots ("…") are separate: they rush down from above and slam the
 * baseline one after another, timed relative to when the letters finish — fully
 * controllable via the dot params.
 *
 * All animation is orchestrated from one effect (so the random choices stay out
 * of render) via the Web Animations API. Re-plays whenever `trigger` changes (a
 * new word) or `params` change (live tuning in the Animation Lab).
 */

export interface SpringTextProps {
  text: string
  params: SpringParams
  /** Change this to re-play the whole word (e.g. the word itself, or a tick). */
  trigger: string | number
}

function dustSpans(count: number) {
  return Array.from({ length: count }).map((_, d) => (
    <span
      key={d}
      data-spring-dust
      aria-hidden
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 0,
        width: 2.5,
        height: 2.5,
        marginLeft: -1.25,
        borderRadius: '50%',
        background: 'currentColor',
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  ))
}

export function SpringText({ text, params, trigger }: SpringTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const chars = [...text]
  const dustPerLetter = Math.max(0, Math.round(params.dustCount))
  const dotCount = Math.max(0, Math.round(params.dotCount))

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const letters = Array.from(root.querySelectorAll<HTMLElement>('[data-spring-letter]'))
    if (letters.length === 0 || typeof letters[0].animate !== 'function') return

    const anims: Animation[] = []

    // --- Letters: random ORDER, even CADENCE (spaced by popInterval + jitter). ---
    const order = letters.map((_, i) => i)
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1))
      ;[order[k], order[j]] = [order[j], order[k]]
    }

    // A dust burst at a baseline element, delayed to `at` ms.
    const kickDust = (wrapper: Element, at: number) => {
      Array.from(wrapper.querySelectorAll<HTMLElement>('[data-spring-dust]')).forEach((d) => {
        if (typeof d.animate !== 'function') return
        const spread = params.groundEffect + params.dustFloat * 0.6
        const dx = (Math.random() * 2 - 1) * spread
        const dy = params.dustFloat * (0.6 + Math.random() * 0.6)
        anims.push(
          d.animate(
            [
              { offset: 0, opacity: 0, transform: 'translate(0px, 0px) scale(0.4)' },
              { offset: 0.15, opacity: 0.65, transform: `translate(${dx * 0.35}px, ${-dy * 0.35}px) scale(1)` },
              { offset: 1, opacity: 0, transform: `translate(${dx}px, ${-dy}px) scale(0.2)` },
            ],
            { duration: Math.max(500, params.dustFloat * 16), delay: at, easing: 'ease-out', fill: 'both' },
          ),
        )
      })
    }

    let lettersEnd = 0
    order.forEach((letterIdx, rank) => {
      const el = letters[letterIdx]
      const delay = rank * params.popInterval + Math.random() * params.jitter
      lettersEnd = Math.max(lettersEnd, delay + params.duration)
      const violent = Math.random() * 100 < params.violentChance
      anims.push(
        el.animate(violent ? violentKeyframes(params) : springKeyframes(params), {
          duration: params.duration,
          delay,
          easing: violent ? 'ease-out' : springEasing(params),
          fill: 'both',
        }),
      )
      const wrapper = el.parentElement
      if (!wrapper) return
      const puff = wrapper.querySelector<HTMLElement>('[data-spring-puff]')
      if (puff && params.groundEffect > 0 && typeof puff.animate === 'function') {
        anims.push(
          puff.animate(
            [
              { offset: 0, opacity: 0, transform: 'translateX(-50%) scaleX(0.2)' },
              { offset: 0.35, opacity: 0.4, transform: 'translateX(-50%) scaleX(1)' },
              { offset: 1, opacity: 0, transform: 'translateX(-50%) scaleX(1.7)' },
            ],
            { duration: Math.min(params.duration * 0.7, 460), delay, easing: 'ease-out', fill: 'both' },
          ),
        )
      }
      kickDust(wrapper, delay)
    })

    // --- Dots: rush down and slam the baseline, one after another, anchored to
    //     when the letters finish (dotDelay shifts them earlier/later). ---
    const dots = Array.from(root.querySelectorAll<HTMLElement>('[data-spring-dot]'))
    dots.forEach((dotEl, di) => {
      if (typeof dotEl.animate !== 'function') return
      const start = Math.max(0, lettersEnd + params.dotDelay + di * params.dotStagger)
      anims.push(
        dotEl.animate(dotKeyframes(params), {
          duration: params.dotDuration,
          delay: start,
          easing: 'linear', // per-keyframe easing drives the fall + snap
          fill: 'both',
        }),
      )
      const wrapper = dotEl.parentElement
      if (wrapper) kickDust(wrapper, start + params.dotDuration * 0.5) // dust on impact
    })

    return () => anims.forEach((a) => a.cancel())
  }, [text, trigger, params])

  return (
    <span ref={rootRef} aria-label={`${text}${dotCount > 0 ? '…' : ''}`} style={{ display: 'inline-block', whiteSpace: 'pre' }}>
      {chars.map((ch, i) =>
        ch === ' ' ? (
          <span key={`${trigger}-${i}`} style={{ display: 'inline-block', width: '0.32em' }} />
        ) : (
          <span key={`${trigger}-${i}`} style={{ position: 'relative', display: 'inline-block' }}>
            <span
              data-spring-letter
              style={{ display: 'inline-block', opacity: 0, willChange: 'transform, opacity' }}
            >
              {ch}
            </span>
            {params.groundEffect > 0 && (
              <span
                data-spring-puff
                aria-hidden
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 0,
                  width: params.groundEffect,
                  height: Math.max(2, params.groundEffect * 0.45),
                  borderRadius: '50%',
                  background: 'currentColor',
                  opacity: 0,
                  transform: 'translateX(-50%)',
                  pointerEvents: 'none',
                  filter: 'blur(0.5px)',
                }}
              />
            )}
            {dustSpans(dustPerLetter)}
          </span>
        ),
      )}
      {Array.from({ length: dotCount }).map((_, di) => (
        <span key={`dot-${trigger}-${di}`} style={{ position: 'relative', display: 'inline-block' }}>
          <span
            data-spring-dot
            style={{ display: 'inline-block', opacity: 0, willChange: 'transform, opacity' }}
          >
            .
          </span>
          {dustSpans(dustPerLetter)}
        </span>
      ))}
    </span>
  )
}
