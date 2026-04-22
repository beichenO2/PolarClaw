import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { ReviewItem, Annotation, PptDiff, PptReview } from '../lib/api'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type ReviewTab = 'all' | 'pdf' | 'ppt'

export function ReviewPage() {
  const [tab, setTab] = useState<ReviewTab>('all')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [selected, setSelected] = useState<ReviewItem | null>(null)
  const [localFile, setLocalFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.review.list()
      setItems(data)
    } catch { /* server may not be up yet */ }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [load])

  const filtered = items.filter((i) => tab === 'all' || i.type === tab)

  const handleLocalFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    const type = ext === 'pdf' ? 'pdf' : 'ppt'

    try {
      const result = await api.review.upload(file)
      await load()
      const uploaded = (await api.review.get(result.id)) as ReviewItem
      setSelected(uploaded)
    } catch {
      const mockItem: ReviewItem = {
        id: `local-${Date.now()}`,
        type: type as 'pdf' | 'ppt',
        filename: file.name,
        status: 'pending',
        agent_id: 'local',
        annotations: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setLocalFile(file)
      setSelected(mockItem)
    }
  }

  if (selected) {
    if (selected.type === 'pdf') {
      return <PdfReviewer item={selected} file={localFile} onBack={() => { setSelected(null); setLocalFile(null) }} onUpdate={load} />
    }
    return <PptReviewer item={selected} onBack={() => { setSelected(null); setLocalFile(null) }} onUpdate={load} />
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

        <label className="ml-auto px-3 py-1.5 text-xs rounded-lg border bg-mc-accent/20 text-mc-accent border-mc-accent/30 cursor-pointer hover:bg-mc-accent/30 transition-colors">
          Open Local File
          <input
            type="file"
            accept=".pdf,.pptx,.ppt"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleLocalFile(e.target.files[0])}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-lg font-medium text-mc-purple">审核产物</p>
          <p className="text-sm text-mc-text-muted max-w-lg mx-auto leading-relaxed">
            Agent 生成的文档（PDF / PPT）会出现在这里。你可以直接在线审核：
            框选 PDF 区域添加修改意见、查看 PPT diff、内联编辑并提交带批注的修改。
          </p>
          <p className="text-xs text-mc-text-muted">也可以用上方 "Open Local File" 打开本地 PDF 试用标注功能。</p>
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

/* ────── PDF Reviewer with pdfjs-dist ────── */

interface PdfReviewerProps {
  item: ReviewItem
  file: File | null
  onBack: () => void
  onUpdate: () => void
}

function PdfReviewer({ item, file, onBack, onUpdate }: PdfReviewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [annotations, setAnnotations] = useState<Annotation[]>(item.annotations)
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [commentText, setCommentText] = useState('')
  const [showCommentFor, setShowCommentFor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 })

  useEffect(() => {
    let cancelled = false
    const loadPdf = async () => {
      setLoading(true)
      setError(null)
      try {
        let src: string | ArrayBuffer
        if (file) {
          src = await file.arrayBuffer()
        } else {
          src = `/api/review/${item.id}/file`
        }
        const doc = await pdfjsLib.getDocument({ data: file ? src as ArrayBuffer : undefined, url: file ? undefined : src as string }).promise
        if (cancelled) return
        pdfDocRef.current = doc
        setNumPages(doc.numPages)
        setCurrentPage(1)
      } catch (err) {
        if (!cancelled) setError(`Failed to load PDF: ${err instanceof Error ? err.message : 'unknown'}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadPdf()
    return () => { cancelled = true }
  }, [item.id, file])

  useEffect(() => {
    const doc = pdfDocRef.current
    if (!doc || !canvasRef.current) return
    let cancelled = false
    const renderPage = async () => {
      const page = await doc.getPage(currentPage)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height
      setCanvasDims({ width: viewport.width, height: viewport.height })
      await page.render({ canvasContext: ctx, viewport }).promise
    }
    renderPage()
    return () => { cancelled = true }
  }, [currentPage, scale, numPages])

  const pageAnnotations = annotations.filter((a) => a.page === currentPage)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!drawing) return
    const rect = overlayRef.current!.getBoundingClientRect()
    setDrawStart({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !drawStart) return
    const rect = overlayRef.current!.getBoundingClientRect()
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
    if (!drawing || !currentRect || currentRect.w < 0.005 || currentRect.h < 0.005) {
      setDrawStart(null)
      setCurrentRect(null)
      return
    }
    setShowCommentFor(currentRect)
    setDrawStart(null)
  }

  const saveAnnotation = async () => {
    if (!showCommentFor || !commentText.trim()) return
    const ann: Annotation = {
      id: `ann-${Date.now()}`,
      page: currentPage,
      x: showCommentFor.x,
      y: showCommentFor.y,
      width: showCommentFor.w,
      height: showCommentFor.h,
      comment: commentText.trim(),
      author: 'user',
      created_at: new Date().toISOString(),
    }
    setAnnotations((prev) => [...prev, ann])
    setShowCommentFor(null)
    setCurrentRect(null)
    setCommentText('')
    setDrawing(false)

    if (!item.id.startsWith('local-')) {
      try {
        await api.review.annotate(item.id, {
          page: ann.page, x: ann.x, y: ann.y,
          width: ann.width, height: ann.height,
          comment: ann.comment, author: ann.author,
        })
      } catch { /* offline ok */ }
    }
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    if (selectedAnn === id) setSelectedAnn(null)
  }

  const submitAll = async () => {
    setSaving(true)
    try {
      for (const ann of annotations) {
        await api.review.annotate(item.id, {
          page: ann.page, x: ann.x, y: ann.y,
          width: ann.width, height: ann.height,
          comment: ann.comment, author: ann.author,
        })
      }
      onUpdate()
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-sm text-mc-accent hover:underline">&larr; Back</button>
        <span className="text-sm font-medium text-mc-text">{item.filename}</span>
        {numPages > 0 && (
          <span className="text-xs text-mc-text-muted">
            Page {currentPage} / {numPages}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="px-2 py-1 text-xs rounded border border-mc-border text-mc-text-muted hover:border-mc-accent"
          >
            -
          </button>
          <span className="text-xs text-mc-text-muted w-12 text-center">{(scale * 100).toFixed(0)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            className="px-2 py-1 text-xs rounded border border-mc-border text-mc-text-muted hover:border-mc-accent"
          >
            +
          </button>
          <button
            onClick={() => setDrawing(!drawing)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium',
              drawing
                ? 'bg-mc-red/20 text-mc-red border-mc-red/30'
                : 'bg-mc-accent/20 text-mc-accent border-mc-accent/30',
            )}
          >
            {drawing ? 'Cancel' : 'Annotate'}
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && <div className="text-center py-16 text-mc-text-muted text-sm">Loading PDF...</div>}
      {error && <div className="text-center py-16 text-mc-red text-sm">{error}</div>}

      {/* PDF Canvas + Overlay */}
      {!loading && !error && (
        <div className="flex gap-4">
          <div className="flex-1 overflow-auto" ref={containerRef}>
            <div className="relative inline-block" style={{ width: canvasDims.width || '100%' }}>
              <canvas ref={canvasRef} className="rounded-xl shadow-lg" style={{ display: 'block' }} />

              <div
                ref={overlayRef}
                className="absolute inset-0"
                style={{ cursor: drawing ? 'crosshair' : 'default' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                {pageAnnotations.map((ann) => (
                  <div
                    key={ann.id}
                    className={clsx(
                      'absolute rounded cursor-pointer transition-colors',
                      selectedAnn === ann.id
                        ? 'border-2 border-mc-accent bg-mc-accent/20'
                        : 'border-2 border-mc-orange/60 bg-mc-orange/10 hover:bg-mc-orange/20',
                    )}
                    style={{
                      left: `${ann.x * 100}%`,
                      top: `${ann.y * 100}%`,
                      width: `${ann.width * 100}%`,
                      height: `${ann.height * 100}%`,
                    }}
                    onClick={() => setSelectedAnn(selectedAnn === ann.id ? null : ann.id)}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] bg-mc-orange text-white px-1 rounded whitespace-nowrap max-w-[200px] truncate">
                      {ann.comment}
                    </span>
                  </div>
                ))}

                {currentRect && (
                  <div
                    className="absolute border-2 border-mc-accent border-dashed bg-mc-accent/10 rounded pointer-events-none"
                    style={{
                      left: `${currentRect.x * 100}%`,
                      top: `${currentRect.y * 100}%`,
                      width: `${currentRect.w * 100}%`,
                      height: `${currentRect.h * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right sidebar: annotations list */}
          <div className="w-72 shrink-0 space-y-3">
            <h3 className="text-sm font-semibold text-mc-accent">
              Annotations ({annotations.length})
            </h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {annotations.map((ann) => (
                <div
                  key={ann.id}
                  className={clsx(
                    'bg-mc-surface border rounded-lg p-3 cursor-pointer transition-colors text-left',
                    selectedAnn === ann.id
                      ? 'border-mc-accent bg-mc-accent/5'
                      : 'border-mc-border hover:border-mc-accent/50',
                  )}
                  onClick={() => {
                    setSelectedAnn(ann.id)
                    setCurrentPage(ann.page)
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-mc-orange font-mono">
                      P{ann.page} ({(ann.x * 100).toFixed(0)}%, {(ann.y * 100).toFixed(0)}%)
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(ann.id) }}
                      className="text-[10px] text-mc-red hover:text-mc-red/80"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="text-xs text-mc-text leading-relaxed">{ann.comment}</p>
                </div>
              ))}
            </div>

            {annotations.length > 0 && !item.id.startsWith('local-') && (
              <button
                onClick={submitAll}
                disabled={saving}
                className="w-full px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium disabled:opacity-50 transition-colors"
              >
                {saving ? 'Submitting...' : 'Submit All to Agent'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Comment input popup */}
      {showCommentFor && (
        <div className="bg-mc-surface border border-mc-border rounded-xl p-4 space-y-3">
          <p className="text-xs text-mc-text-muted">
            Add annotation for region ({(showCommentFor.x * 100).toFixed(0)}%, {(showCommentFor.y * 100).toFixed(0)}%) on page {currentPage}:
          </p>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Describe the modification needed..."
            rows={3}
            className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text resize-y focus:outline-none focus:border-mc-accent"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveAnnotation() }}
          />
          <div className="flex gap-2">
            <button onClick={saveAnnotation} className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium">
              Save (Cmd+Enter)
            </button>
            <button
              onClick={() => { setShowCommentFor(null); setCurrentRect(null); setCommentText('') }}
              className="px-4 py-2 text-sm rounded-lg bg-mc-surface text-mc-text-muted border border-mc-border"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Page nav */}
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
          >
            &larr; Prev
          </button>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(numPages, 10) }, (_, i) => {
              const pageNum = numPages <= 10 ? i + 1 : Math.max(1, currentPage - 4) + i
              if (pageNum > numPages) return null
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={clsx(
                    'w-7 h-7 text-xs rounded transition-colors',
                    currentPage === pageNum
                      ? 'bg-mc-accent text-white'
                      : 'text-mc-text-muted hover:bg-mc-surface',
                  )}
                >
                  {pageNum}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage === numPages}
            className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  )
}

/* ────── PPT Reviewer with diff + inline edit ────── */

function PptReviewer({
  item,
  onBack,
  onUpdate,
}: {
  item: ReviewItem
  onBack: () => void
  onUpdate: () => void
}) {
  const pptItem = item as PptReview
  const slides = pptItem.slides ?? []
  const agentDiffs = pptItem.agent_diffs ?? []

  const [currentSlide, setCurrentSlide] = useState(0)
  const [showDiffView, setShowDiffView] = useState(false)
  const [userEdits, setUserEdits] = useState<PptDiff[]>([])
  const [editingDiff, setEditingDiff] = useState<PptDiff | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editComment, setEditComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const slideDiffs = agentDiffs.filter((d) => d.slide_index === currentSlide)
  const slideUserEdits = userEdits.filter((d) => d.slide_index === currentSlide)

  const startEdit = (diff: PptDiff) => {
    setEditingDiff(diff)
    setEditValue(diff.after)
    setEditComment('')
  }

  const saveEdit = () => {
    if (!editingDiff) return
    const edited: PptDiff = {
      ...editingDiff,
      after: editValue,
      change_type: 'modify',
    }
    setUserEdits((prev) => [...prev.filter((d) => !(d.slide_index === edited.slide_index && d.target === edited.target)), edited])
    setEditingDiff(null)
    setEditValue('')
    setEditComment('')
  }

  const submitDiffs = async () => {
    setSubmitting(true)
    try {
      await api.review.submitDiff(item.id, userEdits)
      onUpdate()
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-sm text-mc-accent hover:underline">&larr; Back</button>
        <span className="text-sm font-medium text-mc-text">{item.filename}</span>
        <span className="text-xs text-mc-text-muted">
          Slide {currentSlide + 1} / {Math.max(slides.length, 1)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowDiffView(!showDiffView)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium',
              showDiffView
                ? 'bg-mc-orange/20 text-mc-orange border-mc-orange/30'
                : 'bg-mc-surface text-mc-text-muted border-mc-border hover:border-mc-orange',
            )}
          >
            {showDiffView ? 'Hide Diff' : 'Show Diff'}
          </button>
        </div>
      </div>

      {/* Slide display */}
      <div className={clsx('grid gap-4', showDiffView ? 'grid-cols-2' : 'grid-cols-1')}>
        <div className="bg-mc-surface border border-mc-border rounded-xl overflow-hidden" style={{ minHeight: 450 }}>
          {slides.length > 0 && slides[currentSlide] ? (
            <img
              src={slides[currentSlide].image_url}
              alt={`Slide ${currentSlide + 1}`}
              className="w-full h-auto"
            />
          ) : (
            <div className="flex items-center justify-center py-24">
              <div className="text-center space-y-2">
                <p className="text-mc-text-muted text-sm">PPT Slide Viewer</p>
                <p className="text-xs text-mc-text-muted">
                  Slides rendered via LibreOffice headless appear here.
                  <br />
                  Agent will provide rendered slide images.
                </p>
              </div>
            </div>
          )}
        </div>

        {showDiffView && (
          <div className="bg-mc-surface border border-mc-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-mc-orange">Agent Changes (Slide {currentSlide + 1})</h3>
            {slideDiffs.length === 0 ? (
              <p className="text-xs text-mc-text-muted">No changes on this slide</p>
            ) : (
              <div className="space-y-3">
                {slideDiffs.map((diff, i) => (
                  <div key={i} className="border border-mc-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        diff.change_type === 'add' ? 'bg-mc-green/20 text-mc-green' :
                        diff.change_type === 'remove' ? 'bg-mc-red/20 text-mc-red' :
                        'bg-mc-yellow/20 text-mc-yellow',
                      )}>
                        {diff.change_type.toUpperCase()}
                      </span>
                      <span className="text-xs text-mc-text-muted font-mono">{diff.target}</span>
                    </div>
                    {diff.change_type !== 'add' && (
                      <div className="text-xs bg-mc-red/5 border border-mc-red/20 rounded px-2 py-1.5 font-mono text-mc-text-muted line-through">
                        {diff.before}
                      </div>
                    )}
                    {diff.change_type !== 'remove' && (
                      <div className="text-xs bg-mc-green/5 border border-mc-green/20 rounded px-2 py-1.5 font-mono text-mc-text">
                        {diff.after}
                      </div>
                    )}
                    <button
                      onClick={() => startEdit(diff)}
                      className="text-[10px] text-mc-accent hover:underline"
                    >
                      Edit this change
                    </button>
                  </div>
                ))}
              </div>
            )}

            {slideUserEdits.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-mc-accent pt-2">Your Edits (Slide {currentSlide + 1})</h3>
                <div className="space-y-2">
                  {slideUserEdits.map((edit, i) => (
                    <div key={i} className="border border-mc-accent/30 rounded-lg p-2 text-xs font-mono">
                      <span className="text-mc-text-muted">{edit.target}: </span>
                      <span className="text-mc-accent">{edit.after}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Inline edit dialog */}
      {editingDiff && (
        <div className="bg-mc-surface border border-mc-accent/30 rounded-xl p-4 space-y-3">
          <p className="text-xs text-mc-text-muted">
            Editing <span className="font-mono text-mc-accent">{editingDiff.target}</span> on slide {editingDiff.slide_index + 1}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-mc-text-muted mb-1">Original</p>
              <div className="bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text-muted font-mono min-h-[60px]">
                {editingDiff.before}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-mc-text-muted mb-1">Your version</p>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text font-mono resize-y min-h-[60px] focus:outline-none focus:border-mc-accent"
                autoFocus
              />
            </div>
          </div>
          <textarea
            value={editComment}
            onChange={(e) => setEditComment(e.target.value)}
            placeholder="Add a comment explaining why (optional)..."
            rows={2}
            className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-xs text-mc-text resize-none focus:outline-none focus:border-mc-accent"
          />
          <div className="flex gap-2">
            <button onClick={saveEdit} className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium">
              Apply Edit
            </button>
            <button onClick={() => setEditingDiff(null)} className="px-4 py-2 text-sm rounded-lg bg-mc-surface text-mc-text-muted border border-mc-border">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Slide nav */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
          disabled={currentSlide === 0}
          className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
        >
          &larr; Prev
        </button>
        <span className="text-xs text-mc-text-muted">
          Slide {currentSlide + 1} / {Math.max(slides.length, 1)}
        </span>
        <button
          onClick={() => setCurrentSlide(Math.min((slides.length || 1) - 1, currentSlide + 1))}
          disabled={currentSlide >= (slides.length || 1) - 1}
          className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
        >
          Next &rarr;
        </button>
      </div>

      {/* Submit all edits */}
      {userEdits.length > 0 && (
        <div className="flex items-center justify-between bg-mc-surface border border-mc-accent/30 rounded-xl p-4">
          <div>
            <p className="text-sm text-mc-text font-medium">{userEdits.length} user edit(s) ready</p>
            <p className="text-xs text-mc-text-muted">Submit all edits back to Agent</p>
          </div>
          <button
            onClick={submitDiffs}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Edits'}
          </button>
        </div>
      )}
    </div>
  )
}
