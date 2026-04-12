/**
 * Build multiple-choice questions from section key points and content.
 * @param {Array<{ heading: string, content: string, keyPoints: string[] }>} sections
 * @returns {Array<{ question: string, options: string[], correct: number, explanation: string }>}
 */
export function generateQuiz(sections) {
  const questions = [];
  const pool = [];

  for (const sec of sections) {
    for (const kp of sec.keyPoints || []) {
      if (kp.length > 8) pool.push({ text: kp, heading: sec.heading });
    }
  }

  if (pool.length === 0) {
    for (const sec of sections) {
      const snippet = (sec.content || '').slice(0, 200).trim();
      if (snippet.length > 20) {
        pool.push({ text: snippet, heading: sec.heading });
      }
    }
  }

  const used = new Set();
  let qIndex = 0;

  for (const item of pool) {
    if (used.has(item.text)) continue;
    used.add(item.text);
    const distractors = pickDistractors(item.text, item.heading, pool, 3);
    if (distractors.length < 3) {
      const fillers = genericDistractors(item.text);
      while (distractors.length < 3 && fillers.length) {
        const f = fillers.shift();
        if (f && f !== item.text && !distractors.includes(f)) distractors.push(f);
      }
    }
    const options = shuffle([item.text, ...distractors.slice(0, 3)]);
    const correct = options.indexOf(item.text);
    if (correct < 0) continue;

    questions.push({
      question: `关于「${item.heading}」，下列哪一项最准确？`,
      options,
      correct,
      explanation: `正确答案是教材要点：${item.text}`,
    });

    qIndex++;
    if (qIndex >= 12) break;
  }

  if (questions.length === 0 && sections.length > 0) {
    const sec = sections[0];
    const body = (sec.content || '请复习本节材料。').slice(0, 120);
    questions.push({
      question: `「${sec.heading}」一节主要讨论什么？`,
      options: [
        body || '本节的核心概念与示例',
        '与主题无关的随机事实',
        '仅包含排版说明',
        '未在材料中出现的内容',
      ],
      correct: 0,
      explanation: '请结合侧边目录逐节阅读以巩固理解。',
    });
  }

  return questions;
}

function pickDistractors(correctText, heading, pool, count) {
  const out = [];
  const candidates = pool.filter(
    (p) => p.text !== correctText && p.heading !== heading
  );
  const shuffled = shuffle([...candidates]);
  for (const c of shuffled) {
    if (out.length >= count) break;
    if (!out.includes(c.text) && c.text.length > 5) out.push(c.text);
  }
  const sameHeading = shuffle(
    pool.filter((p) => p.text !== correctText && p.heading === heading)
  );
  for (const c of sameHeading) {
    if (out.length >= count) break;
    if (!out.includes(c.text)) out.push(c.text);
  }
  return out;
}

function genericDistractors(seed) {
  return [
    '材料中未提及此说法',
    '该选项与学习目标相反',
    '这是其他章节才可能出现的细节',
    `与「${seed.slice(0, 20)}…」明显矛盾的说法`,
  ];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
