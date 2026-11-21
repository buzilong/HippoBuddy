import { useSyncExternalStore } from 'react';

export type ProcessView = 'auto' | 'full' | 'result';
let defaultProcessView: ProcessView = 'auto';
const listeners = new Set<() => void>();

export function normalizeProcessView(view: string | undefined | null): ProcessView {
  return view === 'full' || view === 'result' ? view : 'auto';
}

export function getDefaultProcessCollapsed(): boolean {
  return defaultProcessView !== 'full';
}

export function setDefaultProcessView(view: string | undefined | null): void {
  const next = normalizeProcessView(view);
  if (next === defaultProcessView) return;
  defaultProcessView = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** 配置异步加载或在设置页切换后,已挂载的过程也立即更新。 */
export function useProcessView(): ProcessView {
  return useSyncExternalStore(subscribe, () => defaultProcessView);
}

/** full/result 模式下当前可显示的正文;auto 不依赖最终回答的推断。 */
export function hasStreamingAnswer(
  stream: readonly { kind: string; turn: number; text?: string }[],
  isReasoning: boolean,
  tools: readonly { status: string }[],
  webSearching = false,
) {
  const tail = stream[stream.length - 1];
  return tail?.kind === 'assistant' && !!tail.text && !isReasoning
    && !webSearching && !tools.some((tool) => tool.status === 'running' || tool.status === 'pending_confirmation');
}
