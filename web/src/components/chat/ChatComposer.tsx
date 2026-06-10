import { useEffect, useRef } from 'react'
import type { ChatAnnotation } from '../../lib/chat-api'
import type { UploadedFile } from '../../lib/agent-stream'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop?: (() => void) | undefined
  disabled?: boolean
  pendingAnnotations?: ChatAnnotation[]
  onRemoveAnnotation?: (id: string) => void
  pendingFiles?: UploadedFile[]
  onAddFiles?: (files: File[]) => void
  onRemoveFile?: (index: number) => void
  uploading?: boolean
}

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: '📄', ppt: '📊', pptx: '📊', doc: '📝', docx: '📝',
  xls: '📈', xlsx: '📈', md: '📋', txt: '📋', csv: '📈',
  json: '{ }', xml: '📋', zip: '📦', tar: '📦', gz: '📦',
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
  'directory(zip-extracted)': '📂', 'directory(tar-extracted)': '📂',
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  pendingAnnotations = [],
  onRemoveAnnotation,
  pendingFiles = [],
  onAddFiles,
  onRemoveFile,
  uploading,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    if (!onAddFiles || disabled) return
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) onAddFiles(dropped)
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (!onAddFiles || disabled) return
    const pasted = Array.from(e.clipboardData.files)
    if (pasted.length) onAddFiles(pasted)
  }

  const canSend = !disabled && (value.trim() || pendingFiles.length > 0)

  return (
    <div className="border-t border-[#444654] bg-[#212121] px-4 py-4">
      <div className="max-w-3xl mx-auto">
        {pendingAnnotations.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingAnnotations.map((a, i) => (
              <span
                key={a.id}
                className="text-xs px-2 py-1 rounded-lg bg-[#2f2f2f] border border-[#565869] text-[#c9d1d9] flex items-center gap-1"
              >
                #{i + 1} &quot;{a.quotedText.slice(0, 20)}…&quot;
                <button type="button" className="text-[#8e8ea0] hover:text-white" onClick={() => onRemoveAnnotation?.(a.id)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingFiles.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="text-xs px-2 py-1 rounded-lg bg-[#2f2f2f] border border-[#565869] text-[#c9d1d9] flex items-center gap-1"
              >
                {FILE_TYPE_ICONS[f.type] ?? '📎'} {f.name}
                <button type="button" className="text-[#8e8ea0] hover:text-white ml-1" onClick={() => onRemoveFile?.(i)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {uploading && (
          <div className="text-xs text-[#8e8ea0] mb-2 animate-pulse">上传中…</div>
        )}

        <div
          className="relative flex items-end gap-2 rounded-2xl border border-[#565869] bg-[#2f2f2f] px-4 py-3 shadow-lg"
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => {
              const selected = Array.from(e.target.files ?? [])
              if (selected.length && onAddFiles) onAddFiles(selected)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 w-8 h-8 rounded-lg text-[#8e8ea0] hover:text-white hover:bg-[#444654] flex items-center justify-center disabled:opacity-30 transition-colors"
            aria-label="附件"
            title="上传文件"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onPaste={handlePaste}
            placeholder="发送消息… 可拖拽或粘贴文件"
            rows={1}
            disabled={disabled}
            className="flex-1 bg-transparent text-[#ececec] text-[15px] resize-none outline-none max-h-[200px] placeholder:text-[#8e8ea0]"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canSend) onSend()
              }
            }}
          />

          {onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 w-8 h-8 rounded-lg bg-[#ef4444] text-white flex items-center justify-center"
              aria-label="停止"
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSend}
              onClick={onSend}
              className="shrink-0 w-8 h-8 rounded-lg bg-[#ececec] text-[#212121] disabled:opacity-30 flex items-center justify-center"
              aria-label="发送"
            >
              ↑
            </button>
          )}
        </div>
        <p className="text-center text-[11px] text-[#8e8ea0] mt-2">Enter 发送 · Shift+Enter 换行 · 拖拽/粘贴上传文件 · 选中助手回复可批注</p>
      </div>
    </div>
  )
}
