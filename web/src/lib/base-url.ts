/**
 * Detect the URL prefix when served behind a reverse-proxy / Funnel
 * that adds a path segment (e.g. /3910_PolarClaw).
 *
 *  Direct: /mc/chat        → prefix = ""
 *  Funnel: /3910_PolarClaw/mc/chat → prefix = "/3910_PolarClaw"
 */
function detectPrefix(): string {
  const path = window.location.pathname
  const idx = path.indexOf('/mc/')
  if (idx > 0) return path.slice(0, idx)
  if (path.endsWith('/mc')) return path.slice(0, -3)
  return ''
}

export const API_BASE = detectPrefix()
