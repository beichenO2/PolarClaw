import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { TraceLine } from '../../lib/chat-stream'

interface RunTracePanelProps {
  lines: TraceLine[]
  className?: string
}

export function RunTracePanel({ lines, className }: RunTracePanelProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div className={clsx('flex flex-col bg-[#0a0e14] border-t border-[#444654] font-mono text-[11px]', className)}>
      <div
        className="px-3 py-1 text-[10px] uppercase tracking-wide text-[#6e7681] border-b border-[#21262d] flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <span>Terminal · Data Flow</span>
        <span className="text-[#484f58]">{lines.length} events · {expanded ? '▼' : '▶'}</span>
      </div>
      <pre
        ref={preRef}
        className={clsx(
          'm-0 p-2 overflow-auto text-[#c9d1d9] leading-relaxed transition-all',
          expanded ? 'max-h-[50vh]' : 'max-h-40',
        )}
      >
        {lines.length === 0 && (
          <span className="text-[#484f58] italic">等待运行…</span>
        )}
        {lines.map((line, i) => (
          <span
            key={i}
            className={clsx('block whitespace-pre-wrap', {
              'text-[#7ee8fa] font-semibold': line.kind === 'step_start',
              'text-[#ffa657]': line.kind === 'tool_use',
              'text-[#8b949e]': line.kind === 'tool_result',
              'text-[#e6edf3]': line.kind === 'text',
              'text-[#3fb950]': line.kind === 'step_done',
              'text-[#f85149]': line.kind === 'error',
              'text-[#d2a8ff]': line.kind === 'status' || line.kind === 'data_flow',
            })}
          >
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  )
}
