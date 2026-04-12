import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContent } from '../src/parser.mjs';
import { generateSite } from '../src/generator.mjs';

const sampleMarkdown = `# 异步编程入门

## 回调与事件

JavaScript 常用回调处理异步任务。
- 回调可能形成嵌套地狱
- 错误处理需要约定规范

## Promise

Promise 表示将来完成的值。
- then 链式调用更清晰
- async/await 是语法糖
`;

test('generateSite produces self-contained HTML with expected structure', () => {
  const parsed = parseContent(sampleMarkdown, 'markdown');
  assert.equal(parsed.title, '异步编程入门');
  assert.ok(parsed.sections.length >= 2);

  const { html, title } = generateSite(parsed, { siteTitle: '异步编程入门' });
  assert.equal(title, '异步编程入门');

  assert.match(html, /#0d1117/, 'uses GitHub dark background');
  assert.match(html, /#c9d1d9/, 'uses muted text color');
  assert.match(html, /#58a6ff/, 'uses link accent');

  assert.match(html, /<aside class="sidebar"/, 'has sidebar');
  assert.match(html, /class="nav-link"/, 'has nav links');
  assert.match(html, /<article class="section-card"/, 'has section articles');
  assert.match(html, /id="quiz-section"/, 'has quiz section');
  assert.match(html, /id="quiz-data"/, 'embeds quiz JSON');
  assert.match(html, /read-progress/, 'has progress tracker');
  assert.match(html, /IntersectionObserver/, 'progress uses section visibility');
  assert.match(html, /自测/, 'quiz region labeled');

  assert.match(html, /回调与事件/, 'section heading in HTML');
  assert.match(html, /Promise/, 'second section present');
});

test('parseContent json format normalizes sections', () => {
  const json = JSON.stringify({
    title: '单元测试',
    sections: [
      { heading: 'A', content: '正文一', keyPoints: ['要点1'] },
    ],
  });
  const parsed = parseContent(json, 'json');
  assert.equal(parsed.title, '单元测试');
  assert.equal(parsed.sections[0].keyPoints[0], '要点1');
  const { html } = generateSite(parsed);
  assert.ok(html.includes('单元测试'));
  assert.ok(html.includes('quiz-item') || html.includes('暂无测验'));
});
