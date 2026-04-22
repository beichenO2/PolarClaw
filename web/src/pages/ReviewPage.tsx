import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { ReviewItem, Annotation } from '../lib/api'

type ReviewTab = 'all' | 'pdf' | 'ppt'

export function ReviewPage() {
  const [tab, setTab] = useState<ReviewTab>('all')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [selected, setSelected] = useState<ReviewItem | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.review.list()
      setItems(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [load])

  const filtered = items.filter((i) => tab === 'all' || i.type === tab)

  if (selected) {
    return selected.type === 'pdf'
      ? <PdfReviewer item={selected} onBack={() => setSelected(null)} onUpdate={load} />
      : <PptReviewer item={selected} onBack={() => setSelected(null)} onUpdate={load} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(['all', 'pdf', 'ppt'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors',
              tab === t
                ? 'bg-mc-purple/20 text-mc-purple border-mc-purple/30'
                : 'bg-mc-surface text-mc-text-muted border-mc-border hover:border-mc-accent',
            )}
          >
            {t === 'all' ? 'All' : t.toUpperCase()}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-lg font-medium text-mc-purple">审核产物</p>
          <p className="text-sm text-mc-text-muted max-w-lg mx-auto leading-relaxed">
            Agent 生成的文档（PDF/PPT）会出现在这里。你可以直接在线审核：
            框选 PDF 区域添加修改意见、查看 PPT diff、内联编辑并提交带批注的修改。
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto pt-4">
            <div className="bg-mc-surface border border-mc-border rounded-xl p-4 text-left">
              <p className="text-sm font-medium text-mc-accent mb-1">PDF 审核</p>
              <p className="text-xs text-mc-text-muted">框选区域 + 添加修改意见</p>
            </div>
            <div className="bg-mc-surface border border-mc-border rounded-xl p-4 text-left">
              <p className="text-sm font-medium text-mc-orange mb-1">PPT 审核</p>
              <p className="text-xs text-mc-text-muted">查看 diff + 内联修改 + 批注</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className="w-full text-left bg-mc-surface border border-mc-border rounded-xl p-4 hover:border-mc-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded-full border font-medium',
                  item.type === 'pdf'
                    ? 'bg-mc-accent/20 text-mc-accent border-mc-accent/30'
                    : 'bg-mc-orange/20 text-mc-orange border-mc-orange/30',
                )}>
                  {item.type.toUpperCase()}
                </span>
                <span className="text-sm text-mc-text font-medium">{item.filename}</span>
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded-full border font-medium ml-auto',
                  item.status === 'pending' ? 'bg-mc-yellow/20 text-mc-yellow border-mc-yellow/30' :
                  item.status === 'reviewed' ? 'bg-mc-accent/20 text-mc-accent border-mc-accent/30' :
                  'bg-mc-green/20 text-mc-green border-mc-green/30',
                )}>
                  {item.status}
                </span>
              </div>
              {item.annotations.length > 0 && (
                <p className="text-xs text-mc-text-muted mt-2">{item.annotations.length} annotations</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PdfReviewer({
  item,
  onBack,
  onUpdate: _onUpdate,
}: {
  item: ReviewItem
  onBack: () => void
  onUpdate: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>(item.annotations)
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [commentText, setCommentText] = useState('')
  const [showCommentFor, setShowCommentFor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!drawing) return
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setDrawStart({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !drawStart) return
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const x2 = (e.clientX - rect.left) / rect.width
    const y2 = (e.clientY - rect.top) / rect.height
    setCurrentRect({
      x: Math.min(drawStart.x, x2),
      y: Math.min(drawStart.y, y2),
      w: Math.abs(x2 - drawStart.x),
      h: Math.abs(y2 - drawStart.y),
    })
  }

  const handleMouseUp = () => {
    if (!drawing || !currentRect || currentRect.w < 0.01) {
      setDrawStart(null)
      setCurrentRect(null)
      return
    }
    setShowCommentFor(currentRect)
    setDrawStart(null)
  }

  const saveAnnotation = () => {
    if (!showCommentFor || !commentText.trim()) return
    const newAnnotation: Annotation = {
      id: `ann-${Date.now()}`,
      page: 1,
      x: showCommentFor.x,
      y: showCommentFor.y,
      width: showCommentFor.w,
      height: showCommentFor.h,
      comment: commentText.trim(),
      author: 'user',
      created_at: new Date().toISOString(),
    }
    setAnnotations([...annotations, newAnnotation])
    setShowCommentFor(null)
    setCurrentRect(null)
    setCommentText('')
    setDrawing(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-mc-accent hover:underline">&larr; Back</button>
        <span className="text-sm font-medium text-mc-text">{item.filename}</span>
        <button
          onClick={() => setDrawing(!drawing)}
          className={clsx(
            'ml-auto px-3 py-1.5 text-xs rounded-lg border transition-colors',
            drawing
              ? 'bg-mc-red/20 text-mc-red border-mc-red/30'
              : 'bg-mc-accent/20 text-mc-accent border-mc-accent/30',
          )}
        >
          {drawing ? 'Cancel Drawing' : 'Draw Annotation'}
        </button>
      </div>

      <div className="relative bg-mc-surface border border-mc-border rounded-xl overflow-hidden" style={{ minHeight: 600 }}>
        <canvas ref={canvasRef} className="w-full h-full" style={{ background: '#1a1a2e', minHeight: 600 }} />

        <div
          className="absolute inset-0"
          style={{ cursor: drawing ? 'crosshair' : 'default' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-mc-text-muted text-sm">PDF viewer (load a PDF to annotate)</p>
          </div>

          {annotations.map((ann) => (
            <div
              key={ann.id}
              className="absolute border-2 border-mc-orange/60 bg-mc-orange/10 rounded"
              style={{ left: `${ann.x * 100}%`, top: `${ann.y * 100}%`, width: `${ann.width * 100}%`, height: `${ann.height * 100}%` }}
              title={ann.comment}
            >
              <span className="absolute -top-5 left-0 text-[10px] bg-mc-orange text-white px-1 rounded whitespace-nowrap">
                {ann.comment.slice(0, 30)}{ann.comment.length > 30 ? '...' : ''}
              </span>
            </div>
          ))}

          {currentRect && (
            <div
              className="absolute border-2 border-mc-accent border-dashed bg-mc-accent/10 rounded"
              style={{ left: `${currentRect.x * 100}%`, top: `${currentRect.y * 100}%`, width: `${currentRect.w * 100}%`, height: `${currentRect.h * 100}%` }}
            />
          )}
        </div>
      </div>

      {showCommentFor && (
        <div className="bg-mc-surface border border-mc-border rounded-xl p-4 space-y-3">
          <p className="text-xs text-mc-text-muted">Add annotation comment:</p>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Describe the modification needed..."
            rows={3}
            className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text resize-y focus:outline-none focus:border-mc-accent"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={saveAnnotation} className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium">
              Save
            </button>
            <button onClick={() => { setShowCommentFor(null); setCurrentRect(null); setCommentText('') }} className="px-4 py-2 text-sm rounded-lg bg-mc-surface text-mc-text-muted border border-mc-border">
              Cancel
            </button>
          </div>
        </div>
      )}

      {annotations.length > 0 && (
        <div className="bg-mc-surface border border-mc-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-mc-accent mb-3">Annotations ({annotations.length})</h3>
          <div className="space-y-2">
            {annotations.map((ann) => (
              <div key={ann.id} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-mc-orange font-mono whitespace-nowrap">
                  P{ann.page} ({(ann.x * 100).toFixed(0)},{(ann.y * 100).toFixed(0)})
                </span>
                <span className="text-mc-text">{ann.comment}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PptReviewer({
  item,
  onBack,
  onUpdate: _onUpdate,
}: {
  item: ReviewItem
  onBack: () => void
  onUpdate: () => void
}) {
  const [currentSlide, setCurrentSlide] = useState(0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-mc-accent hover:underline">&larr; Back</button>
        <span className="text-sm font-medium text-mc-text">{item.filename}</span>
        <span className="text-xs text-mc-text-muted ml-auto">Slide {currentSlide + 1}</span>
      </div>

      <div className="bg-mc-surface border border-mc-border rounded-xl overflow-hidden" style={{ minHeight: 500 }}>
        <div className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <p className="text-mc-text-muted text-sm">PPT Slide Viewer</p>
            <p className="text-xs text-mc-text-muted">Slides rendered via LibreOffice will appear here</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
          disabled={currentSlide === 0}
          className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-xs text-mc-text-muted">Slide {currentSlide + 1}</span>
        <button
          onClick={() => setCurrentSlide(currentSlide + 1)}
          className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent"
        >
          Next
        </button>
      </div>

      <div className="bg-mc-surface border border-mc-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-mc-orange mb-3">Agent Diff</h3>
        <p className="text-xs text-mc-text-muted">Agent changes will appear here in before/after format</p>
      </div>
    </div>
  )
}
