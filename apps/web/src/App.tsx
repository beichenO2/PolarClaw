import { useState } from 'react';
import { mockBoard, mockEvolution, mockOutcomes, mockResearch } from './data/mock';

type Tab = 'overview' | 'evolution' | 'board' | 'research';

export function App() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="shell">
      <header className="topbar">
        <div className="octicon" aria-hidden>
          MC
        </div>
        <div className="repo-nav">
          <strong>MyClaw</strong>
          <span>/</span>
          <span>dashboard</span>
        </div>
        <nav className="tabs" aria-label="Primary">
          {(
            [
              ['overview', '概览'],
              ['evolution', '进化'],
              ['board', '任务'],
              ['research', '研究'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'true' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        <aside className="sidebar">
          <h2>About</h2>
          <ul>
            <li>结果优先，少展示实现细节。</li>
            <li>后续可对接 Gateway / Hub API。</li>
          </ul>
        </aside>

        <main className="main">
          {tab === 'overview' && (
            <section aria-labelledby="overview-h">
              <div className="panel">
                <h3 id="overview-h">本周结果</h3>
                <div className="grid-2">
                  {mockOutcomes.map((o) => (
                    <article key={o.id} className="card">
                      <h4>{o.title}</h4>
                      <p>{o.summary}</p>
                      {o.metric ? <span className="metric">{o.metric}</span> : null}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          )}

          {tab === 'evolution' && (
            <section className="panel" aria-labelledby="evo-h">
              <h3 id="evo-h">自进化</h3>
              {mockEvolution.map((e) => (
                <div key={e.id} className="evolution-row">
                  <div>
                    <strong>{e.direction}</strong>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                      {e.lastWin}
                    </p>
                  </div>
                  <span className={`badge ${e.status}`}>{e.status}</span>
                </div>
              ))}
            </section>
          )}

          {tab === 'board' && (
            <section className="panel" aria-labelledby="board-h">
              <h3 id="board-h">任务看板</h3>
              <div className="board">
                {(['backlog', 'doing', 'done'] as const).map((col) => (
                  <div key={col} className="column">
                    <h4>{col}</h4>
                    {mockBoard
                      .filter((t) => t.column === col)
                      .map((t) => (
                        <div key={t.id} className="task-pill">
                          {t.title}
                          {t.module ? <small>{t.module}</small> : null}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'research' && (
            <section className="panel" aria-labelledby="res-h">
              <h3 id="res-h">研究报告</h3>
              {mockResearch.map((block, i) => (
                <div key={i} className="research-block">
                  <header>
                    <h4>{block.heading}</h4>
                    <span className="confidence">{block.confidence}</span>
                  </header>
                  <ul>
                    {block.bullets.map((b, j) => (
                      <li key={j}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
