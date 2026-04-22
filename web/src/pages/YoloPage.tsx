import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AlignmentDoc } from '../lib/api'
import { renderMarkdown } from '../lib/markdown'

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'text-gray-400 border-gray-600' },
  pending_review: { text: '待审核', color: 'text-yellow-400 border-yellow-600' },
  approved: { text: '已批准', color: 'text-green-400 border-green-600' },
  rejected: { text: '已驳回', color: 'text-red-400 border-red-600' },
  executing: { text: '执行中', color: 'text-blue-400 border-blue-600' },
  completed: { text: '已完成', color: 'text-green-400 border-green-600' },
}

export function YoloPage() {
  const [docs, setDocs] = useState<AlignmentDoc[]>([])
  const [hubOk, setHubOk] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuffer, setEditBuffer] = useState('')
  const [editOriginal, setEditOriginal] = useState('')

  const load = useCallback(async () => {
    try {
      const all = await api.hub.alignment.list()
      setDocs([...all].reverse())
      setHubOk(true)
    } catch {
      setHubOk(false)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 4000)
    return () => clearInterval(iv)
  }, [load])

  const handleConfirm = async (docId: string, name: string, confirmed: boolean) => {
    await api.hub.alignment.confirmSection(docId, name, confirmed)
    await load()
  }

  const handleApprove = async (docId: string) => {
    await api.hub.alignment.approve(docId)
    await load()
  }

  const handleReject = async (docId: string) => {
    const comment = prompt('驳回原因（可选）:')
    await api.hub.alignment.reject(docId, comment ?? undefined)
    await load()
  }

  const startEdit = (doc: AlignmentDoc) => {
    setEditingId(doc.id)
    setEditBuffer(doc.plan_markdown)
    setEditOriginal(doc.plan_markdown)
  }

  const saveEdit = async (doc: AlignmentDoc) => {
    if (editBuffer === editOriginal) { setEditingId(null); return }
    await api.hub.alignment.update(doc.id, { plan_markdown: editBuffer, changed_by: 'user' })
    const pending = await api.hub.prompts.pending()
    const p = pending.find(pr => pr.agent_id === doc.agent_id && !pr.answered)
    if (p) await api.hub.prompts.answer(p.id, `用户编辑了对齐方案`)
    setEditingId(null)
    await load()
  }

  const canEdit = (doc: AlignmentDoc) => ['draft', 'pending_review', 'rejected'].includes(doc.status)

  if (!hubOk) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-lg font-medium text-red-400">Hub 未连接</p>
        <p className="text-sm text-mc-text-muted">
          YOLO 功能需要 PolarCopilot Hub 运行中（默认 :10015）。
          <br />确认 Hub 启动后刷新页面。
        </p>
      </div>
    )
  }

  if (docs.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-lg font-medium text-mc-purple">YOLO 全自动模式</p>
        <p className="text-sm text-mc-text-muted max-w-lg mx-auto leading-relaxed">
          在 Hub Web UI 或通过 Agent 触发 YOLO 模式后，对齐方案将在此显示。
        </p>
        <div className="flex justify-center gap-6 pt-4">
          <div className="text-xs space-y-1">
            <p className="text-mc-purple font-medium">三维对齐</p>
            <p className="text-mc-text-muted">极限目标 + 工作逻辑 + 预期体验</p>
          </div>
          <div className="text-xs space-y-1">
            <p className="text-mc-purple font-medium">执行优先级</p>
            <p className="text-mc-text-muted">Debug &gt; Test &gt; Dev</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {docs.map(doc => {
        const info = STATUS_LABELS[doc.status] ?? STATUS_LABELS.draft!
        const editing = editingId === doc.id
        const sections = doc.sections ?? []
        const allConfirmed = sections.length > 0 && sections.every(s => s.confirmed)

        return (
          <div key={doc.id} className="bg-mc-surface border border-mc-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3 border-b border-mc-border flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${info.color}`}>
                {info.text}
              </span>
              <span className="text-sm text-mc-accent font-medium">{doc.agent_id}</span>
              <span className="text-xs text-mc-text-muted">v{doc.version}</span>
              <span className="ml-auto flex items-center gap-2">
                {canEdit(doc) && !editing && (
                  <button onClick={() => startEdit(doc)} className="text-xs px-2.5 py-1 rounded-lg border border-mc-border text-mc-text-muted hover:text-mc-accent hover:border-mc-accent transition-colors">
                    编辑方案
                  </button>
                )}
                <span className="text-xs text-mc-text-muted">
                  {new Date(doc.created_at).toLocaleString('zh', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </span>
            </div>

            {/* Goal */}
            {doc.goal && (
              <div className="px-5 py-3 border-b border-mc-border bg-mc-bg/50">
                <p className="text-xs text-mc-purple font-medium mb-1">极限目标</p>
                <p className="text-sm text-mc-text">{doc.goal}</p>
              </div>
            )}

            {/* Content */}
            {editing ? (
              <div className="px-5 py-4">
                <textarea
                  value={editBuffer}
                  onChange={e => setEditBuffer(e.target.value)}
                  className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-3 text-sm text-mc-text font-mono leading-relaxed resize-y min-h-[400px] focus:outline-none focus:border-mc-purple transition-[border-color]"
                />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => saveEdit(doc)} className="px-4 py-2 text-sm rounded-lg bg-mc-purple/80 text-white hover:bg-mc-purple transition-colors font-medium">
                    保存修改
                  </button>
                  <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm rounded-lg bg-mc-surface text-mc-text-muted border border-mc-border hover:border-mc-accent transition-colors">
                    取消
                  </button>
                </div>
              </div>
            ) : doc.plan_markdown ? (
              <div
                className="px-5 py-4 text-sm leading-relaxed markdown-body [&_h1]:text-mc-purple [&_h2]:text-mc-purple [&_h3]:text-mc-purple [&_code]:text-mc-purple [&_th]:text-mc-purple"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.plan_markdown) }}
              />
            ) : null}

            {/* Section checklist */}
            {sections.length > 0 && (
              <div className="px-5 py-3 border-t border-mc-border">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-mc-text-muted">
                    对齐确认 ({sections.filter(s => s.confirmed).length}/{sections.length})
                  </p>
                  {allConfirmed && doc.status !== 'approved' && (
                    <button onClick={() => handleApprove(doc.id)} className="px-3 py-1 text-xs rounded-lg bg-green-600/80 text-white hover:bg-green-600 transition-colors font-medium">
                      全部确认，开始 YOLO
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {sections.map(s => (
                    <div key={s.name} className="flex items-center gap-2">
                      <button
                        onClick={() => handleConfirm(doc.id, s.name, !s.confirmed)}
                        disabled={doc.status === 'approved' || doc.status === 'completed'}
                        className={`w-5 h-5 rounded border flex items-center justify-center text-xs transition-colors ${
                          s.confirmed ? 'bg-green-600/20 border-green-600/40 text-green-400' : 'border-mc-border hover:border-mc-accent'
                        } ${(doc.status === 'approved' || doc.status === 'completed') ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {s.confirmed ? '✓' : ''}
                      </button>
                      <span className="text-sm text-mc-text">{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {canEdit(doc) && !editing && (
              <div className="px-5 py-3 border-t border-mc-border flex gap-2">
                <button onClick={() => handleApprove(doc.id)} className="px-4 py-2 text-sm rounded-lg bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors font-medium">
                  批准
                </button>
                <button onClick={() => handleReject(doc.id)} className="px-4 py-2 text-sm rounded-lg bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors font-medium">
                  驳回
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
