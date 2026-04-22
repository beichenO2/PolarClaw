import { renderMarkdown } from '../lib/markdown'

export function YoloPage() {
  return (
    <div className="space-y-6">
      <div className="text-center py-12 space-y-4">
        <p className="text-lg font-medium text-mc-purple">YOLO 全自动模式</p>
        <p className="text-sm text-mc-text-muted max-w-lg mx-auto leading-relaxed">
          MyClaw YOLO 模式通过三维对齐（极限目标 + 工作逻辑 + 预期体验）确保 Agent
          完全理解你的意图，然后全自动执行。对齐方案可在此直接编辑。
        </p>
        <div className="flex justify-center gap-4 pt-2">
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

      <div className="bg-mc-surface border border-mc-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-mc-accent mb-3">YOLO 功能说明</h3>
        <div
          className="text-sm leading-relaxed markdown-body"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown([
              '### 对齐流程',
              '',
              '1. 通过飞书/CLI 触发 YOLO 模式',
              '2. Agent 生成对齐方案文档',
              '3. 在此页面查看、编辑、确认方案',
              '4. 确认后 Agent 全自动执行',
              '',
              '### 集成状态',
              '',
              '| 组件 | 状态 |',
              '|------|------|',
              '| YOLO Engine | 已实现（490行） |',
              '| 对齐验证 | 启发式 + LLM-as-judge |',
              '| 错误恢复 | 4种策略（重试/跳过/上报/中止） |',
              '| Hub API 桥接 | 待实现 |',
            ].join('\n')),
          }}
        />
      </div>
    </div>
  )
}
