import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'

const PLACEHOLDER_PREFIX = '___MATH_'

/**
 * Render Markdown + LaTeX to sanitized HTML.
 *
 * Pipeline: extract math → marked → restore KaTeX HTML.
 * Supports $$…$$, $…$, \[…\], \(…\) delimiters.
 */
export function renderMarkdown(src: string): string {
  const mathBlocks: string[] = []

  function stash(latex: string, displayMode: boolean): string {
    const idx = mathBlocks.length
    try {
      mathBlocks.push(
        katex.renderToString(latex, { displayMode, throwOnError: false }),
      )
    } catch {
      mathBlocks.push(
        `<code class="katex-error">${escapeHtml(latex)}</code>`,
      )
    }
    return `${PLACEHOLDER_PREFIX}${idx}___`
  }

  let s = src

  // Protect fenced code blocks from math extraction
  const codeBlocks: string[] = []
  s = s.replace(/```[\s\S]*?```/g, (m) => {
    const ci = codeBlocks.length
    codeBlocks.push(m)
    return `___CODEBLOCK_${ci}___`
  })

  // Display math: \[…\] (GPT-style, can span lines)
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex: string) => stash(tex.trim(), true))

  // Display math: $$…$$ (can span lines)
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex: string) => stash(tex.trim(), true))

  // Inline math: \(…\) (single line)
  s = s.replace(/\\\(([^\n]*?)\\\)/g, (_, tex: string) => stash(tex.trim(), false))

  // Inline math: $…$ (single line, guarded against $$, currency patterns)
  s = s.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\d)/g, (_, tex: string) => stash(tex.trim(), false))

  // Restore code blocks
  s = s.replace(/___CODEBLOCK_(\d+)___/g, (_, i) => codeBlocks[Number(i)] ?? '')

  // Run marked
  const html = marked.parse(s, { async: false }) as string

  // Restore math placeholders (KaTeX HTML is already safe)
  const restored = html.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)___`, 'g'),
    (_, i) => mathBlocks[Number(i)] ?? '',
  )

  // Sanitize but allow KaTeX elements
  return DOMPurify.sanitize(restored, {
    ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'mfrac', 'msup',
      'msub', 'mover', 'munder', 'munderover', 'msqrt', 'mroot', 'mtable',
      'mtr', 'mtd', 'mtext', 'mspace', 'annotation', 'svg', 'path', 'line',
      'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'g', 'use', 'defs',
      'clipPath', 'mask', 'pattern', 'image', 'foreignObject', 'span'],
    ADD_ATTR: ['xmlns', 'xlink:href', 'viewBox', 'd', 'fill', 'stroke',
      'stroke-width', 'transform', 'x', 'y', 'width', 'height', 'cx', 'cy',
      'r', 'rx', 'ry', 'points', 'preserveAspectRatio', 'style', 'class',
      'aria-hidden', 'focusable', 'role', 'encoding', 'mathvariant'],
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
