import type { Message, ToolCallRecord, WebSearchAction } from '@/types';
import type { StreamItem } from '@/stores/chatStore';
import {
  fromToolCallRecord,
  fromToolMessage,
  type TimelineToolItem,
} from '../tool-renderers/tool-timeline-utils';
import { deepMergeTodoList, parseTodoArgs, type FlatTodo } from '../tool-renderers/shared-utils';

export type ProcessEntry =
  | { kind: 'reasoning'; id: string; text: string; timestamp?: number }
  | { kind: 'tool'; id: string; tool: TimelineToolItem; timestamp?: number; endedAt?: number }
  | { kind: 'search'; id: string; actions: WebSearchAction[]; timestamp?: number };

export type ConversationItem =
  | { kind: 'text'; id: string; message: Message; streaming: boolean }
  | { kind: 'interaction'; id: string; tool: TimelineToolItem }
  | {
      kind: 'process';
      id: string;
      entries: ProcessEntry[];
      active: boolean;
      interrupted: boolean;
      elapsedMs: number | null;
    };

type Event = Exclude<ConversationItem, { kind: 'process' }> | ProcessEntry;

function textContent(content: Message['content']): string {
  return typeof content === 'string'
    ? content
    : content
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('\n');
}

interface ConversationInput {
  messages: Message[];
  stream?: StreamItem[];
  toolCalls?: ToolCallRecord[];
  isSending?: boolean;
  isReasoning?: boolean;
  webSearching?: boolean;
  webSearchActions?: WebSearchAction[];
  interrupted?: boolean;
  initialTodos?: FlatTodo[];
  todoList?: FlatTodo[];
}

/** 两条数据路径先还原为同一事件序列,再以正文为边界分段。正文永远不进入折叠区。 */
export function buildConversationView({
  messages,
  stream = [],
  toolCalls = [],
  isSending = false,
  isReasoning = false,
  webSearching = false,
  webSearchActions = [],
  interrupted = false,
  initialTodos = [],
  todoList,
}: ConversationInput): { items: ConversationItem[]; todos: FlatTodo[] } {
  const events: Event[] = [];
  const liveTools = new Map(toolCalls.map((tool) => [tool.id, tool]));
  const results = new Map(
    messages
      .filter((message) => message.role === 'tool')
      .map((message) => [message.toolCallId ?? message.id, message]),
  );
  const seenTools = new Set<string>();
  const seenMessages = new Set<string>();
  let todos = initialTodos;

  const addTool = (id: string, fallback: TimelineToolItem, timestamp?: number) => {
    if (seenTools.has(id)) return;
    seenTools.add(id);
    const live = liveTools.get(id);
    const tool = live ? fromToolCallRecord(live) : { ...fallback, id };
    if (tool.name === 'todo_write') {
      const parsed = parseTodoArgs(tool.args);
      todos =
        parsed.mode === 'replace'
          ? deepMergeTodoList([], parsed.todos)
          : deepMergeTodoList(todos, parsed.todos);
      tool.args = { mode: 'merge', todos: live && todoList ? todoList : todos };
    }
    // 实时确认和提问由聊天面板的独立操作区渲染。
    if (tool.confirmationData || (live && tool.name === 'ask_user')) return;
    if (tool.name === 'ask_user') events.push({ kind: 'interaction', id, tool });
    else
      events.push({
        kind: 'tool',
        id,
        tool,
        timestamp: live?.startedAt || timestamp,
        endedAt: live?.endedAt,
      });
  };
  const addAssistant = (message: Message, streaming = false, thinking = false) => {
    if (seenMessages.has(message.id)) return;
    seenMessages.add(message.id);
    if (message.reasoning_content || thinking)
      events.push({
        kind: 'reasoning',
        id: `${message.id}:reasoning`,
        text: message.reasoning_content ?? '',
        timestamp: message.timestamp,
      });
    if (message.web_search_actions?.length)
      events.push({
        kind: 'search',
        id: `${message.id}:search`,
        actions: message.web_search_actions,
        timestamp: message.timestamp,
      });
    if (textContent(message.content))
      events.push({
        kind: 'text',
        id: message.id,
        streaming,
        message: {
          ...message,
          reasoning_content: undefined,
          web_searched: false,
          web_search_actions: undefined,
        },
      });
    for (const call of message.tool_calls ?? []) {
      const result = results.get(call.id);
      const tool = result
        ? fromToolMessage(result)
        : { id: call.id, name: call.name, status: 'cancelled' as const };
      addTool(
        call.id,
        { ...tool, name: call.name, args: call.arguments },
        result?.timestamp ?? message.timestamp,
      );
    }
  };
  for (const message of messages) {
    if (message.role === 'assistant') addAssistant(message);
    else if (message.role === 'tool')
      addTool(message.toolCallId ?? message.id, fromToolMessage(message), message.timestamp);
  }
  stream.forEach((entry, index) => {
    if (entry.kind === 'assistant') {
      const open = index === stream.length - 1 && isSending;
      addAssistant(
        {
          id: `s-${entry.turn}-${index}`,
          role: 'assistant',
          content: entry.text,
          reasoning_content: entry.reasoning || undefined,
          timestamp: entry.createdAt,
          web_search_actions: open && !webSearching ? webSearchActions : undefined,
        },
        open,
        open && isReasoning,
      );
    } else {
      const live = liveTools.get(entry.callId);
      if (live) addTool(live.id, fromToolCallRecord(live), live.startedAt);
    }
  });
  if (webSearching)
    events.push({
      kind: 'search',
      id: `${stream[stream.length - 1]?.turn ?? 'live'}:web-search`,
      actions: webSearchActions,
    });

  if (!events.length && isSending && !toolCalls.some((tool) => !!tool.confirmationData)) {
    events.push({ kind: 'reasoning', id: 'awaiting-response', text: '' });
  }
  const items: ConversationItem[] = [];
  let pending: ProcessEntry[] = [];
  const flush = (nextTime?: number, tail = false) => {
    if (!pending.length) return;
    const times = pending
      .map((entry) => entry.timestamp)
      .filter((time): time is number => time != null && time > 0);
    const start = times.length ? Math.min(...times) : 0;
    const ends = pending.flatMap((entry) =>
      entry.kind === 'tool' && entry.endedAt ? [entry.endedAt] : [],
    );
    const end = Math.max(nextTime ?? 0, ...times, ...ends);
    items.push({
      kind: 'process',
      id: `process:${pending[0].id}`,
      entries: pending,
      active: tail && isSending,
      interrupted: tail && interrupted,
      // 历史记录缺少单段结束时间时省略耗时,不把整轮耗时重复计入每段。
      elapsedMs: start && end > start ? end - start : null,
    });
    pending = [];
  };
  for (const event of events) {
    if (event.kind === 'text' || event.kind === 'interaction') {
      flush(event.kind === 'text' ? event.message.timestamp : undefined);
      items.push(event);
    } else pending.push(event);
  }
  flush(undefined, true);
  if (interrupted && items[items.length - 1]?.kind !== 'process') {
    items.push({
      kind: 'process',
      id: `interrupted:${items[items.length - 1]?.id ?? 'empty'}`,
      entries: [],
      active: false,
      interrupted: true,
      elapsedMs: null,
    });
  }
  return { items, todos };
}

export function toolRecord(tool: TimelineToolItem): ToolCallRecord {
  let status: ToolCallRecord['status'];
  switch (tool.status) {
    case 'running':
    case 'success':
    case 'failed':
    case 'denied':
      status = tool.status;
      break;
    case 'cancelled':
      // 卡片数据类型没有 cancelled;仅在卡片适配时归并为 failed。
      // 过程摘要与工具时间线仍保留原始 cancelled 状态,显示已中断。
      status = 'failed';
      break;
    case 'pending_confirmation':
      // 待确认工具必须留在独立确认区,不可转换为普通结果卡片。
      throw new Error('Pending confirmation must be rendered in the confirmation UI');
    default: {
      const exhaustive: never = tool.status;
      throw new Error(`Unsupported tool status: ${exhaustive}`);
    }
  }
  return {
    id: tool.id,
    name: tool.name,
    args: tool.args,
    progress: tool.progress ?? [],
    status,
    result: tool.result ?? tool.content,
    error: tool.error,
    startedAt: 0,
  };
}

export function toolCategory(name: string): string {
  if (['read_file', 'read_office_file'].includes(name)) return 'read';
  if (['grep', 'glob', 'web_search', 'SearchCodebase'].includes(name)) return 'search';
  if (name === 'bash') return 'command';
  if (['edit_file', 'write_file', 'write_office_file', 'delete_file', 'undo_file'].includes(name))
    return 'write';
  if (name === 'list_directory') return 'inspect';
  if (name === 'web_fetch') return 'web';
  if (name === 'todo_write') return 'todo';
  return 'other';
}
