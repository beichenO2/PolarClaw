import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ResearchPipeline,
  coordinateTopic,
  defaultPlan,
  gatherEvidence,
  synthesizeReport,
} from '../src/index.mjs';

test('coordinateTopic trims query', () => {
  const t = coordinateTopic({ query: '  hello world  ', title: ' T ' });
  assert.equal(t.query, 'hello world');
  assert.equal(t.title, 'T');
});

test('defaultPlan splits sentences into sub-questions', async () => {
  const plan = await defaultPlan({ query: 'First idea. Second idea! Third?' });
  assert.equal(plan.subQuestions.length, 3);
  assert.match(plan.subQuestions[0].id, /^sq-/);
});

test('ResearchPipeline.run wires plan → search → report', async () => {
  const calls = [];
  const pipeline = new ResearchPipeline({
    search: async (q) => {
      calls.push(q);
      return [{ snippet: `result:${q}`, url: 'https://example.test' }];
    },
  });
  const report = await pipeline.run({ query: 'Only one chunk' });
  assert.equal(calls.length, 1);
  assert.ok(report.executiveSummary.includes('Only one chunk'));
  assert.equal(report.sections.length, 1);
  assert.ok(report.sections[0].body.includes('example.test'));
});

test('run rejects empty query', async () => {
  const p = new ResearchPipeline({ search: async () => [] });
  await assert.rejects(() => p.run({ query: '   ' }), /empty topic/);
});

test('gatherEvidence maps each sub-question', async () => {
  const plan = {
    subQuestions: [
      { id: 'a', question: 'Q1' },
      { id: 'b', question: 'Q2' },
    ],
  };
  const ev = await gatherEvidence(plan, async (q) => [{ snippet: q }]);
  assert.deepEqual(ev, [
    { subQuestionId: 'a', hits: [{ snippet: 'Q1' }] },
    { subQuestionId: 'b', hits: [{ snippet: 'Q2' }] },
  ]);
});

test('synthesizeReport builds sections', () => {
  const topic = { query: 'topic' };
  const plan = { subQuestions: [{ id: 'x', question: 'Sub?' }] };
  const evidence = [{ subQuestionId: 'x', hits: [{ snippet: 'hit', url: 'https://u' }] }];
  const r = synthesizeReport(topic, plan, evidence);
  assert.equal(r.sections[0].heading, 'Sub?');
  assert.ok(r.sections[0].body.includes('hit'));
});
