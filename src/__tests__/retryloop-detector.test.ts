import { describe, it, expect } from 'vitest';
import { detectRetryLoop, buildRetryLoopClarification } from '../core/retryloop-detector.js';

describe('detectRetryLoop', () => {
  it('detects "RetryLoop 5 次"', () => {
    const r = detectRetryLoop('给我 RetryLoop 5 次');
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(5);
    expect(r.isDiscussion).toBe(false);
  });

  it('detects "retryloop 3 循环"', () => {
    const r = detectRetryLoop('retryloop 3 循环');
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(3);
  });

  it('detects "RetryLoop 7 遍"', () => {
    const r = detectRetryLoop('这个任务 RetryLoop 7 遍');
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(7);
  });

  it('detects "执行 RetryLoop 10"', () => {
    const r = detectRetryLoop('执行 RetryLoop 10');
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(10);
  });

  it('does NOT trigger for "解释一下 RetryLoop"', () => {
    const r = detectRetryLoop('解释一下 RetryLoop');
    expect(r.triggered).toBe(false);
    expect(r.isDiscussion).toBe(true);
  });

  it('does NOT trigger for "什么是 RetryLoop"', () => {
    const r = detectRetryLoop('什么是 RetryLoop');
    expect(r.triggered).toBe(false);
    expect(r.isDiscussion).toBe(true);
  });

  it('does NOT trigger for "RetryLoop 是什么意思"', () => {
    const r = detectRetryLoop('RetryLoop 是什么意思');
    expect(r.triggered).toBe(false);
    expect(r.isDiscussion).toBe(true);
  });

  it('does NOT trigger for unrelated text', () => {
    const r = detectRetryLoop('帮我写个函数');
    expect(r.triggered).toBe(false);
    expect(r.isDiscussion).toBe(false);
  });

  it('detects case-insensitive', () => {
    const r = detectRetryLoop('RETRYLOOP 3 轮');
    expect(r.triggered).toBe(true);
    expect(r.count).toBe(3);
  });
});

describe('buildRetryLoopClarification', () => {
  it('includes count in message', () => {
    const msg = buildRetryLoopClarification(5);
    expect(msg).toContain('RetryLoop 5 次');
    expect(msg).toContain('停止条件');
    expect(msg).toContain('YOLO');
  });
});
