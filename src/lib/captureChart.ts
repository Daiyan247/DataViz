/**
 * Capture the rendered chart inside `container` as a PNG data URL — the WebGL
 * <canvas> for maps, or the <svg> for Vega charts — so it can be sent to the vision
 * model for image analysis. Returns null when capture isn't possible (the analysis
 * then falls back to reasoning from the data digest alone).
 */

export async function captureChartImage(container: HTMLElement | null): Promise<string | null> {
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
  if (svg) return svgToPng(svg as SVGSVGElement)
  return null
}

function svgToPng(svg: SVGSVGElement): Promise<string | null> {
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
          ctx.fillStyle = '#ffffff' // a solid background so the chart is legible
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
