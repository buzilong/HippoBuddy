import { describe, it, expect, beforeEach } from 'vitest';
import { getDefaultProcessCollapsed, setDefaultProcessView, normalizeProcessView, hasStreamingAnswer } from '@/utils/process-view-config';

describe('process-view-config', () => {
  beforeEach(() => {
    setDefaultProcessView('full'); // 重置模块级默认值,避免用例互相影响
  });

  it('full 模式下默认不收起', () => {
    setDefaultProcessView('full');
    expect(getDefaultProcessCollapsed()).toBe(false);
  });

  it('result 模式下默认收起', () => {
    setDefaultProcessView('result');
    expect(getDefaultProcessCollapsed()).toBe(true);
  });

  it('兜底:未知值按 auto 处理', () => {
    setDefaultProcessView('whatever');
    expect(getDefaultProcessCollapsed()).toBe(true);
  });

  it('空值/undefined/null 按 auto 处理', () => {
    setDefaultProcessView(undefined);
    expect(getDefaultProcessCollapsed()).toBe(true);
    setDefaultProcessView('asdf');
    expect(getDefaultProcessCollapsed()).toBe(true);
  });
});

describe('process mode compatibility', () => {
  it('configuration defaults to auto and preserves explicit legacy modes', () => {
    expect(normalizeProcessView(undefined)).toBe('auto');
    expect(normalizeProcessView(null)).toBe('auto');
    expect(normalizeProcessView('full')).toBe('full');
    expect(normalizeProcessView('result')).toBe('result');
  });

  it('only a current assistant text segment starts an answer', () => {
    const text = { kind: 'assistant', turn: 1, text: 'answer' };
    expect(hasStreamingAnswer([text], false, [])).toBe(true);
    expect(hasStreamingAnswer([text], true, [])).toBe(false);
    expect(hasStreamingAnswer([text, { kind: 'tool', turn: 1 }], false, [])).toBe(false);
    expect(hasStreamingAnswer([text], false, [{ status: 'running' }])).toBe(false);
    expect(hasStreamingAnswer([text], false, [], true)).toBe(false);
  });
});
