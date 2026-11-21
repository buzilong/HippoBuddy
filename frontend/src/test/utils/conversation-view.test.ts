import { describe, expect, it } from 'vitest';
import { buildConversationView, toolRecord } from '@/components/chat-panel/conversation-view';
import type { Message, ToolCallRecord } from '@/types';
import type { StreamItem } from '@/stores/chatStore';

const assistant = (id: string, content = '', reasoning_content = ''): Message => ({
  id,
  role: 'assistant',
  content,
  reasoning_content,
});
const tool = (id: string, name = 'read_file'): ToolCallRecord => ({
  id,
  name,
  status: 'success',
  startedAt: 1000,
  endedAt: 2000,
  progress: [],
  args: { path: `${id}.ts` },
  result: 'ok',
});

describe('conversation view boundaries', () => {
  it('splits reasoning, text and subsequent tools without swallowing any text', () => {
    const messages: Message[] = [
      assistant('a1', 'first', 'plan'),
      { id: 't1', role: 'tool', toolName: 'bash', content: 'ok', success: true },
      assistant('a2', 'second', 'next plan'),
    ];
    const { items } = buildConversationView({ messages });
    expect(items.map((item) => item.kind)).toEqual(['process', 'text', 'process', 'text']);
    expect(
      items.filter((item) => item.kind === 'text').map((item) => item.message.content),
    ).toEqual(['first', 'second']);
    expect(items[2].kind === 'process' && items[2].entries.map((entry) => entry.kind)).toEqual([
      'tool',
      'reasoning',
    ]);
  });

  it('coalesces 25 tools and repeated thinking segments into one process if no text separates them', () => {
    const stream: StreamItem[] = [];
    const tools = Array.from({ length: 25 }, (_, index) => tool(`t${index}`));
    tools.forEach((record, index) => {
      stream.push({ kind: 'assistant', turn: index + 1, text: '', reasoning: 'planning' });
      stream.push({ kind: 'tool', turn: index + 1, callId: record.id });
    });
    const { items } = buildConversationView({
      messages: [],
      stream,
      toolCalls: tools,
      isSending: true,
    });
    expect(items).toHaveLength(1);
    expect(
      items[0].kind === 'process' && items[0].entries.filter((entry) => entry.kind === 'tool'),
    ).toHaveLength(25);
  });

  it('reconstructs server tool calls with arguments and consumes matching results once', () => {
    const message = {
      ...assistant('a1', 'checking'),
      tool_calls: [{ id: 'call1', name: 'read_file', arguments: '{"path":"src/main.ts"}' }],
    };
    const { items } = buildConversationView({
      messages: [
        message,
        { id: 'result1', role: 'tool', toolCallId: 'call1', content: 'file', success: true },
      ],
    });
    expect(items.map((item) => item.kind)).toEqual(['text', 'process']);
    const block = items[1];
    expect(block.kind === 'process' && block.entries).toHaveLength(1);
    expect(
      block.kind === 'process' && block.entries[0].kind === 'tool' && block.entries[0].tool.args,
    ).toBe('{"path":"src/main.ts"}');
  });

  it('uses the same block and text identities before and after streaming commits', () => {
    const stream: StreamItem[] = [
      { kind: 'assistant', turn: 2, text: '', reasoning: 'plan' },
      { kind: 'tool', turn: 2, callId: 't1' },
      { kind: 'assistant', turn: 3, text: 'answer', reasoning: '' },
    ];
    const live = buildConversationView({
      messages: [],
      stream,
      toolCalls: [tool('t1')],
      isSending: true,
    });
    const saved = buildConversationView({
      messages: [
        assistant('s-2-0', '', 'plan'),
        {
          id: 't1',
          toolCallId: 't1',
          role: 'tool',
          toolName: 'read_file',
          content: 'ok',
          success: true,
        },
        assistant('s-3-2', 'answer'),
      ],
    });
    expect(live.items.map((item) => item.id)).toEqual(saved.items.map((item) => item.id));
  });

  it('merges confirmation continuation into the last adjacent process without duplicating tools', () => {
    const messages: Message[] = [
      assistant('a1', 'checking'),
      { id: 't1', role: 'tool', toolCallId: 't1', toolName: 'bash', content: '' },
    ];
    const stream: StreamItem[] = [
      { kind: 'tool', turn: 2, callId: 't1' },
      { kind: 'assistant', turn: 3, text: '', reasoning: 'continue' },
    ];
    const { items } = buildConversationView({
      messages,
      stream,
      toolCalls: [tool('t1', 'bash')],
      isSending: true,
    });
    expect(items.map((item) => item.kind)).toEqual(['text', 'process']);
    expect(items[1].kind === 'process' && items[1].entries.map((entry) => entry.kind)).toEqual([
      'tool',
      'reasoning',
    ]);
  });

  it('leaves live confirmation/question controls to their independent UI and keeps historical questions outside process blocks', () => {
    const pending = {
      ...tool('pending', 'bash'),
      confirmationData: { confirmId: 'c1', command: 'echo hi', riskLevel: 'low', riskReason: '' },
    } as ToolCallRecord;
    const { items } = buildConversationView({
      messages: [],
      stream: [{ kind: 'tool', turn: 1, callId: 'pending' }],
      toolCalls: [pending],
    });
    expect(items).toHaveLength(0);
    expect(
      buildConversationView({
        messages: [{ id: 'ask', role: 'tool', toolName: 'ask_user', content: 'answer' }],
      }).items[0].kind,
    ).toBe('interaction');
  });

  it('marks interruption without hiding partially streamed text, and does not invent elapsed time for old data', () => {
    const { items } = buildConversationView({
      messages: [assistant('a1', 'partial')],
      interrupted: true,
    });
    expect(items.map((item) => item.kind)).toEqual(['text', 'process']);
    expect(items[1].kind === 'process' && items[1].interrupted).toBe(true);
    expect(items[1].kind === 'process' && items[1].elapsedMs).toBeNull();
  });

  it('merges todo updates without mutating inputs', () => {
    const first = {
      ...tool('todo1', 'todo_write'),
      args: { todos: [{ id: 'a', content: 'A', status: 'pending' }] },
    };
    const next = {
      ...tool('todo2', 'todo_write'),
      args: { todos: [{ id: 'b', content: 'B', status: 'pending' }] },
    };
    const { todos } = buildConversationView({
      messages: [],
      stream: [
        { kind: 'tool', turn: 1, callId: 'todo1' },
        { kind: 'tool', turn: 1, callId: 'todo2' },
      ],
      toolCalls: [first, next],
    });
    expect(todos.map((item) => item.id)).toEqual(['a', 'b']);
    expect(first.args.todos).toHaveLength(1);
  });
});

describe('tool card status adaptation', () => {
  it.each(['running', 'success', 'failed', 'denied'] as const)(
    'preserves the supported %s state',
    (status) => {
      expect(toolRecord({ id: 't1', name: 'todo_write', status }).status).toBe(status);
    },
  );

  it('maps cancellation only for cards, preserving the original timeline state', () => {
    const source = {
      id: 't1',
      name: 'todo_write',
      status: 'cancelled' as const,
      content: 'interrupted',
    };
    const record = toolRecord(source);
    expect(record.status).toBe('failed');
    expect(record.result).toBe('interrupted');
    expect(source.status).toBe('cancelled');
  });

  it('rejects pending confirmations instead of converting them into failed result cards', () => {
    expect(() => toolRecord({ id: 't1', name: 'bash', status: 'pending_confirmation' })).toThrow(
      'confirmation UI',
    );
  });
});
