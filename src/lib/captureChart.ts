/**
 * Capture the rendered chart inside `container` as a PNG data URL — the WebGL
 * <canvas> for maps, or the <svg> for Vega charts — so it can be sent to the vision
 * model for image analysis. Returns null when capture isn't possible (the analysis
 * then falls back to reasoning from the data digest alone).
 *
 * `container` must wrap the CHART ONLY. Pointing it at an outer card captures the
 * first <svg> in DOM order, and any lucide icon rendered above the chart (the advice
 * panel's warning triangle, say) is an <svg> — so the vision model would be handed a
 * 16px icon and asked to describe the trend in it.
 *
 * `background` must be the surface the chart is actually drawn on: the Vega theme
 * sets a transparent background with theme-coloured axes, so flattening a dark-mode
 * chart onto white leaves pale text on white — unreadable to the model.
 */

export async function captureChartImage(
  container: HTMLElement | null,
  background = '#ffffff',
): Promise<string | null> {
  if (!container) return null
  const canvas = container.querySelector('canvas')
  if (canvas) {
    try {
      return canvas.toDataURL('image/png')
    } catch {
      return null // tainted/lost context
    }
  }
  const svg = container.querySelector('svg')
  if (svg) return svgToPng(svg as SVGSVGElement, background)
  return null
}

function svgToPng(svg: SVGSVGElement, background: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const rect = svg.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width || svg.clientWidth || 800))
      const h = Math.max(1, Math.round(rect.height || svg.clientHeight || 500))
      const xml = new XMLSerializer().serializeToString(svg)
      const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(null)
          ctx.fillStyle = background // the chart's real surface, so contrast survives
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/png'))
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = src
    } catch {
      resolve(null)
    }
  })
}
