import { generateQuiz } from './quiz.mjs';

/**
 * @param {{ title: string, sections: Array<{ heading: string, content: string, keyPoints: string[] }> }} parsedContent
 * @param {{ siteTitle?: string, includeQuiz?: boolean }} [options]
 * @returns {{ html: string, title: string }}
 */
export function generateSite(parsedContent, options = {}) {
  const title =
    options.siteTitle ||
    (parsedContent && parsedContent.title) ||
    'Learning module';
  const sections = Array.isArray(parsedContent?.sections)
    ? parsedContent.sections
    : [];
  const includeQuiz = options.includeQuiz !== false;
  const quiz = includeQuiz ? generateQuiz(sections) : [];

  const html = buildDocument({ title, sections, quiz });
  return { html, title };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'section';
}

function buildDocument({ title, sections, quiz }) {
  const navItems = sections.map((sec, i) => {
    const id = `sec-${slugify(sec.heading)}-${i}`;
    return { id, label: sec.heading };
  });

  const sectionsHtml = sections
    .map((sec, i) => {
      const id = navItems[i].id;
      const body = formatContent(sec.content);
      const keys =
        sec.keyPoints && sec.keyPoints.length
          ? `<ul class="key-points">${sec.keyPoints
              .map((k) => `<li>${escapeHtml(k)}</li>`)
              .join('')}</ul>`
          : '';
      return `<article class="section-card" id="${escapeHtml(id)}" data-section-index="${i}">
  <h2 class="section-title">${escapeHtml(sec.heading)}</h2>
  <div class="section-body">${body}</div>
  ${keys}
</article>`;
    })
    .join('\n');

  const navHtml = navItems
    .map(
      (n) =>
        `<a class="nav-link" href="#${escapeHtml(n.id)}">${escapeHtml(
          n.label
        )}</a>`
    )
    .join('');

  const quizJson = JSON.stringify(quiz)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-muted: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --link: #58a6ff;
      --link-hover: #79b8ff;
      --accent: #238636;
      --accent-muted: #2ea043;
      --danger: #f85149;
      --radius: 6px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }
    a { color: var(--link); text-decoration: none; }
    a:hover { color: var(--link-hover); text-decoration: underline; }
    .layout {
      display: grid;
      grid-template-columns: minmax(220px, 280px) 1fr;
      min-height: 100vh;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: relative; border-right: none; border-bottom: 1px solid var(--border); }
    }
    .sidebar {
      position: sticky;
      top: 0;
      align-self: start;
      max-height: 100vh;
      overflow: auto;
      padding: 1.25rem 1rem;
      background: var(--bg-muted);
      border-right: 1px solid var(--border);
    }
    .brand {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .site-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin: 0 0 1rem;
      line-height: 1.35;
    }
    .nav-link {
      display: block;
      padding: 0.35rem 0.5rem;
      border-radius: var(--radius);
      color: var(--text);
      font-size: 0.875rem;
      margin-bottom: 2px;
    }
    .nav-link:hover {
      background: rgba(88, 166, 255, 0.12);
      text-decoration: none;
      color: var(--link);
    }
    .progress-wrap {
      margin-top: 1.25rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
    .progress-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.35rem;
    }
    .progress-bar {
      height: 8px;
      background: var(--bg);
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--accent-muted));
      border-radius: 999px;
      transition: width 0.35s ease;
    }
    .progress-stats {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.35rem;
    }
    main {
      padding: 2rem clamp(1rem, 4vw, 3rem);
      max-width: 880px;
    }
    .hero h1 {
      font-size: clamp(1.75rem, 4vw, 2.25rem);
      font-weight: 600;
      margin: 0 0 0.5rem;
      letter-spacing: -0.02em;
    }
    .hero p {
      color: var(--text-muted);
      margin: 0 0 2rem;
      font-size: 0.95rem;
    }
    .section-card {
      margin-bottom: 2.5rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--border);
    }
    .section-card:last-of-type { border-bottom: none; }
    .section-title {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0 0 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .section-body {
      font-size: 0.95rem;
    }
    .section-body p { margin: 0 0 1rem; }
    .key-points {
      margin: 1rem 0 0;
      padding-left: 1.25rem;
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    .key-points li { margin-bottom: 0.35rem; }
    .quiz-region {
      margin-top: 3rem;
      padding: 1.5rem;
      background: var(--bg-muted);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .quiz-region h2 {
      margin: 0 0 1rem;
      font-size: 1.2rem;
    }
    .quiz-item {
      margin-bottom: 1.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .quiz-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .quiz-q { font-weight: 500; margin-bottom: 0.75rem; }
    .quiz-options { display: flex; flex-direction: column; gap: 0.5rem; }
    .quiz-opt {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.5rem 0.65rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      font: inherit;
      color: var(--text);
      text-align: left;
      transition: border-color 0.15s, background 0.15s;
    }
    .quiz-opt:hover:not(:disabled) {
      border-color: var(--link);
      background: rgba(88, 166, 255, 0.08);
    }
    .quiz-opt:disabled { cursor: default; opacity: 0.95; }
    .quiz-opt.correct { border-color: var(--accent-muted); background: rgba(46, 160, 67, 0.15); }
    .quiz-opt.wrong { border-color: var(--danger); background: rgba(248, 81, 73, 0.12); }
    .quiz-explain {
      margin-top: 0.65rem;
      font-size: 0.85rem;
      color: var(--text-muted);
      display: none;
    }
    .quiz-explain.visible { display: block; }
    code, pre {
      font-family: var(--mono);
      font-size: 0.88em;
    }
    pre {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 1rem;
      border-radius: var(--radius);
      overflow: auto;
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">Study</div>
      <h1 class="site-title">${escapeHtml(title)}</h1>
      <nav class="nav" aria-label="章节">${navHtml}</nav>
      <div class="progress-wrap">
        <div class="progress-label">学习进度</div>
        <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="read-progress">
          <div class="progress-fill" id="read-progress-fill"></div>
        </div>
        <div class="progress-stats" id="progress-stats">已读 0 / ${sections.length} 节</div>
      </div>
    </aside>
    <main>
      <header class="hero">
        <h1>${escapeHtml(title)}</h1>
        <p>交互式单页学习页 · 使用左侧目录跳转 · 完成测验巩固要点</p>
      </header>
      ${sectionsHtml || '<p class="section-body">暂无章节内容。</p>'}
      <section class="quiz-region" id="quiz-section" aria-label="测验" data-quiz-count="${quiz.length}">
        <h2>自测</h2>
        <div id="quiz-mount"></div>
      </section>
    </main>
  </div>
  <script type="application/json" id="quiz-data">${quizJson}</script>
  <script>
(function () {
  var dataEl = document.getElementById('quiz-data');
  var quiz = [];
  try { quiz = JSON.parse(dataEl.textContent || '[]'); } catch (e) { quiz = []; }
  var mount = document.getElementById('quiz-mount');
  if (!quiz.length && mount) {
    mount.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">暂无测验题。补充要点列表后可自动生成选择题。</p>';
  } else if (mount) {
    quiz.forEach(function (q, qi) {
      var block = document.createElement('div');
      block.className = 'quiz-item';
      block.setAttribute('data-quiz-index', String(qi));
      var qEl = document.createElement('div');
      qEl.className = 'quiz-q';
      qEl.textContent = (qi + 1) + '. ' + q.question;
      block.appendChild(qEl);
      var opts = document.createElement('div');
      opts.className = 'quiz-options';
      var answered = false;
      q.options.forEach(function (opt, oi) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz-opt';
        btn.textContent = String.fromCharCode(65 + oi) + '. ' + opt;
        btn.addEventListener('click', function () {
          if (answered) return;
          answered = true;
          var correct = oi === q.correct;
          Array.prototype.forEach.call(opts.children, function (b, bi) {
            b.disabled = true;
            if (bi === q.correct) b.classList.add('correct');
            else if (bi === oi && !correct) b.classList.add('wrong');
          });
          var ex = document.createElement('div');
          ex.className = 'quiz-explain visible';
          ex.textContent = q.explanation || '';
          block.appendChild(ex);
          window.dispatchEvent(new CustomEvent('quiz-answered', { detail: { correct: correct } }));
        });
        opts.appendChild(btn);
      });
      block.appendChild(opts);
      mount.appendChild(block);
    });
  }

  var articles = document.querySelectorAll('article.section-card');
  var total = articles.length;
  var seen = {};
  var fill = document.getElementById('read-progress-fill');
  var bar = document.getElementById('read-progress');
  var stats = document.getElementById('progress-stats');
  var quizDone = 0;
  var quizTotal = quiz.length;

  function updateProgress() {
    var n = Object.keys(seen).length;
    var readPct = total ? Math.round((n / total) * 70) : 0;
    var quizPct = quizTotal ? Math.round((quizDone / quizTotal) * 30) : 0;
    var pct = Math.min(100, readPct + quizPct);
    if (fill) fill.style.width = pct + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
    if (stats) stats.textContent = '已读 ' + n + ' / ' + total + ' 节' + (quizTotal ? ' · 测验 ' + quizDone + '/' + quizTotal : '');
  }

  if ('IntersectionObserver' in window && articles.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var idx = en.target.getAttribute('data-section-index');
          if (idx != null) seen[idx] = true;
          updateProgress();
        }
      });
    }, { root: null, threshold: 0.25 });
    articles.forEach(function (el) { io.observe(el); });
  }

  window.addEventListener('quiz-answered', function () {
    quizDone++;
    updateProgress();
  });

  updateProgress();
})();
  </script>
</body>
</html>`;
}

function formatContent(text) {
  if (!text || !String(text).trim()) return '<p>（无正文）</p>';
  const blocks = String(text).split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (trimmed.startsWith('```')) {
        const m = trimmed.match(/^```(\w*)?\n([\s\S]*?)```$/);
        if (m) {
          return `<pre><code>${escapeHtml(m[2].trim())}</code></pre>`;
        }
      }
      const lines = trimmed.split(/\r?\n/);
      const htmlLines = lines.map((line) => {
        if (/^[-*•]\s+/.test(line)) {
          return `<li>${escapeHtml(line.replace(/^[-*•]\s+/, ''))}</li>`;
        }
        return escapeHtml(line);
      });
      if (htmlLines.some((l) => l.startsWith('<li>'))) {
        const lis = htmlLines.filter((l) => l.startsWith('<li>'));
        const ps = htmlLines.filter((l) => !l.startsWith('<li>'));
        let out = '';
        if (lis.length) out += '<ul>' + lis.join('') + '</ul>';
        if (ps.length) out += ps.map((p) => (p ? '<p>' + p + '</p>' : '')).join('');
        return out || '<p>' + escapeHtml(trimmed) + '</p>';
      }
      return '<p>' + htmlLines.join('<br/>') + '</p>';
    })
    .join('');
}
