import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConversationFlow } from '@/components/chat-panel/ConversationFlow';
import { buildConversationView } from '@/components/chat-panel/conversation-view';
import { setDefaultProcessView } from '@/utils/process-view-config';
import { useChatStore } from '@/stores/chatStore';
import { useAppStore } from '@/stores/appStore';
import type { Message, ToolCallRecord } from '@/types';

beforeEach(() => setDefaultProcessView('auto'));
const records: ToolCallRecord[] = Array.from({ length: 24 }, (_, index) => ({
  id: `t${index}`,
  name: 'read_file',
  status: index < 4 ? 'running' : 'success',
  startedAt: 1000,
  progress: [],
  args: { path: `src/file${index}.ts` },
  result: 'ok',
}));
const toolStream = records.map((tool) => ({ kind: 'tool' as const, turn: 1, callId: tool.id }));

describe('interleaved conversation UI', () => {
  it('shows one compact process and at most three live actions for 24 tools', () => {
    const { items } = buildConversationView({
      messages: [],
      stream: toolStream,
      toolCalls: records,
      isSending: true,
    });
    const { container } = render(<ConversationFlow items={items} />);
    expect(container.querySelectorAll('.conversation-process')).toHaveLength(1);
    expect(container.querySelectorAll('.conversation-process-action')).toHaveLength(3);
    expect(container.querySelector('.conversation-process-detail')).not.toBeVisible();
    expect(screen.queryByText('已思考')).toBeNull();
  });

  it('keeps an expanded process open when output arrives and when the process completes', () => {
    const live = buildConversationView({
      messages: [],
      stream: toolStream,
      toolCalls: records,
      isSending: true,
    });
    const { container, rerender } = render(<ConversationFlow items={live.items} />);
    fireEvent.click(container.querySelector('.conversation-process-summary')!);
    expect(container.querySelector('.conversation-process-detail')).toBeVisible();
    const updated = buildConversationView({
      messages: [],
      stream: toolStream,
      toolCalls: records.map((tool) => ({ ...tool, status: 'success' })),
      isSending: false,
    });
    rerender(<ConversationFlow items={updated.items} />);
    expect(container.querySelector('.conversation-process-summary')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(container.querySelector('.conversation-process-detail')).toBeVisible();
  });

  it('keeps prior text DOM in place when tools arrive and during live-to-history commit', () => {
    useAppStore.setState({ currentSessionId: 'flow-test' });
    useChatStore.setState({ sessionStreams: {} });
    const store = useChatStore.getState();
    store.setSessionIsSending('flow-test', true);
    store.routeSseEvent('flow-test', { event: 'thinking', data: { turn: 1 } });
    store.routeSseEvent('flow-test', { event: 'content', data: { content: 'First explanation' } });
    const view = () =>
      buildConversationView({ ...useChatStore.getState().sessionStreams['flow-test'] });
    const { container, rerender } = render(<ConversationFlow items={view().items} />);
    const originalText = container.querySelector('.msg-markdown');
    act(() => {
      store.routeSseEvent('flow-test', {
        event: 'tool_start',
        data: { id: 'bash1', name: 'bash', args: '{"command":"echo hi"}' },
      });
    });
    rerender(<ConversationFlow items={view().items} />);
    expect(container.querySelector('.msg-markdown')).toBe(originalText);
    expect(screen.getByText('First explanation')).toBeVisible();
    act(() => {
      store.routeSseEvent('flow-test', {
        event: 'tool_result',
        data: { id: 'bash1', name: 'bash', success: true, result: 'hi' },
      });
      store.routeSseEvent('flow-test', { event: 'thinking', data: { turn: 2 } });
      store.routeSseEvent('flow-test', {
        event: 'content',
        data: { content: 'Final explanation' },
      });
    });
    rerender(<ConversationFlow items={view().items} />);
    expect(container.querySelector('.msg-markdown')).toBe(originalText);
    const process = container.querySelector('.conversation-process');
    act(() => store.routeSseEvent('flow-test', { event: 'done', data: {} }));
    rerender(<ConversationFlow items={view().items} />);
    expect(container.querySelector('.msg-markdown')).toBe(originalText);
    expect(container.querySelector('.conversation-process')).toBe(process);
    expect(screen.getByText('First explanation')).toBeVisible();
    expect(screen.getByText('Final explanation')).toBeVisible();
  });

  it('keeps raw reasoning hidden inside the expanded timeline until requested', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Answer',
        reasoning_content: 'Private reasoning detail',
      },
    ];
    const { items } = buildConversationView({ messages });
    const { container } = render(<ConversationFlow items={items} />);
    expect(screen.getByText('Answer')).toBeVisible();
    expect(screen.getByText('Private reasoning detail')).not.toBeVisible();
    fireEvent.click(container.querySelector('.conversation-process-summary')!);
    expect(container.querySelector('.conversation-process-detail')).toBeVisible();
    expect(container.querySelector('.conversation-process-reasoning')).not.toHaveAttribute('open');
    expect(screen.getByText('Answer').closest('.conversation-process')).toBeNull();
  });

  it('shows failed operations and interruption on compact summaries', () => {
    const { items } = buildConversationView({
      messages: [{ id: 't1', role: 'tool', toolName: 'bash', content: 'error', success: false }],
      interrupted: true,
    });
    render(<ConversationFlow items={items} />);
    expect(screen.getByText(/1 项失败/)).toBeVisible();
    expect(screen.getByText(/已中断/)).toBeVisible();
  });

  it('follows new process details until the reader scrolls up, then resumes near the bottom', () => {
    const view = () =>
      buildConversationView({
        messages: [],
        stream: toolStream,
        toolCalls: records,
        isSending: true,
      });
    const { container, rerender } = render(<ConversationFlow items={view().items} />);
    fireEvent.click(container.querySelector('.conversation-process-summary')!);
    const viewport = container.querySelector('.conversation-process-detail') as HTMLDivElement;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 320 },
    });
    rerender(<ConversationFlow items={view().items} />);
    expect(viewport.scrollTop).toBe(1000);
    viewport.scrollTop = 200;
    fireEvent.scroll(viewport);
    rerender(<ConversationFlow items={view().items} />);
    expect(viewport.scrollTop).toBe(200);
    viewport.scrollTop = 680;
    fireEvent.scroll(viewport);
    Object.defineProperty(viewport, 'scrollHeight', { value: 1200 });
    rerender(<ConversationFlow items={view().items} />);
    expect(viewport.scrollTop).toBe(1200);
  });
});
