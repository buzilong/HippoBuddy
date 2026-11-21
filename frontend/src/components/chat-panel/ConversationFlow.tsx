import { Fragment, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { MessageBubble } from './MessageBubble';
import { ToolTimeline } from '../tool-renderers/ToolTimeline';
import { ToolCardDispatcher } from '../tool-renderers/ToolCardDispatcher';
import { timelineSummary } from '../tool-renderers/shared-utils';
import {
  toolCategory,
  toolRecord,
  type ConversationItem,
  type ProcessEntry,
} from './conversation-view';
import './ConversationFlow.css';

export function ConversationFlow({ items }: { items: ConversationItem[] }) {
  return (
    <>
      {items.map((item) =>
        item.kind === 'text' ? (
          <MessageBubble
            key={item.id}
            message={item.message}
            dataMessageId={item.id}
            isStreaming={item.streaming}
          />
        ) : item.kind === 'interaction' ? (
          <ToolCardDispatcher key={item.id} record={toolRecord(item.tool)} />
        ) : (
          <ProcessBlock key={item.id} block={item} />
        ),
      )}
    </>
  );
}

function ProcessBlock({ block }: { block: Extract<ConversationItem, { kind: 'process' }> }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!block.active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [block.active]);
  useEffect(() => {
    if (expanded && block.active && following.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [block.entries, expanded, block.active]);
  const tools = block.entries.flatMap((entry) => (entry.kind === 'tool' ? [entry.tool] : []));
  const current = tools.find((tool) => tool.status === 'running');
  const counts = new Map<string, number>();
  tools.forEach((tool) => {
    const category = toolCategory(tool.name);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  });
  block.entries.forEach((entry) => {
    if (entry.kind !== 'search') return;
    const queries = entry.actions
      .filter((action) => action.type === 'search')
      .reduce((count, action) => count + (action.queries?.length ?? 1), 0);
    const pages = entry.actions.filter((action) => action.type === 'open_page').length;
    if (queries) counts.set('search', (counts.get('search') ?? 0) + queries);
    if (pages) counts.set('web', (counts.get('web') ?? 0) + pages);
  });
  const summary = block.active
    ? t(
        `chat.flow.active.${current ? toolCategory(current.name) : block.entries[block.entries.length - 1]?.kind === 'search' ? 'search' : 'thinking'}`,
      )
    : [...counts]
        .map(([category, count]) => t(`chat.flow.count.${category}`, { count }))
        .join(' · ') || t('chat.reasoningDone');
  const failed = tools.filter((tool) => tool.status === 'failed').length;
  const cancelled = tools.some((tool) => tool.status === 'cancelled');
  const start = block.entries
    .map((entry) => entry.timestamp)
    .find((time) => time != null && time > 0);
  const elapsed = block.active && start ? Math.max(0, now - start) : block.elapsedMs;
  const running = tools.filter((tool) => tool.status === 'running');
  const recent = running.slice(0, 3);
  const remaining = 3 - recent.length;
  if (remaining)
    recent.push(...tools.filter((tool) => tool.status !== 'running').slice(-remaining));
  const toggle = () => {
    following.current = true;
    setExpanded((value) => !value);
  };
  if (!block.entries.length)
    return (
      <div className="conversation-process conversation-process-meta" role="status">
        {t('chat.flow.interrupted')}
      </div>
    );
  return (
    <section
      className={`conversation-process${block.active ? ' active' : ''}`}
      data-process-id={block.id}
    >
      <button
        type="button"
        className="conversation-process-summary"
        onClick={toggle}
        aria-expanded={expanded}
      >
        <span aria-hidden className="conversation-process-glyph">
          {block.active ? '◌' : expanded ? '⌄' : '›'}
        </span>
        <span>{summary}</span>
        {elapsed != null && elapsed > 0 && (
          <span className="conversation-process-meta">
            · {t('chat.flow.seconds', { seconds: (elapsed / 1000).toFixed(1) })}
          </span>
        )}
        {failed > 0 && (
          <span className="conversation-process-error">
            · {t('chat.flow.failed', { count: failed })}
          </span>
        )}
        {(block.interrupted || cancelled) && (
          <span className="conversation-process-meta">· {t('chat.flow.interrupted')}</span>
        )}
        <span className="conversation-process-toggle">
          {expanded ? t('chat.collapseProcess') : t('chat.flow.view')}
        </span>
      </button>
      {block.active && !expanded && recent.length > 0 && (
        <div className="conversation-process-preview">
          {recent.map((tool) => (
            <div key={tool.id} className="conversation-process-action">
              <span aria-hidden>
                {tool.status === 'running' ? '◌' : tool.status === 'success' ? '✓' : '!'}
              </span>
              <span
                className="conversation-process-action-text"
                title={timelineSummary(tool.name, tool.args)}
              >
                {t(`chat.flow.action.${toolCategory(tool.name)}`)}{' '}
                {timelineSummary(tool.name, tool.args)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div
        className="conversation-process-detail"
        hidden={!expanded}
        ref={viewport}
        onScroll={(event) => {
          const el = event.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {block.entries.map((entry) => (
          <Fragment key={entry.id}>
            <ProcessDetail entry={entry} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function ProcessDetail({ entry }: { entry: ProcessEntry }) {
  const { t } = useI18n();
  if (entry.kind === 'reasoning')
    return (
      <details className="conversation-process-reasoning">
        <summary>{t('chat.flow.reasoning')}</summary>
        <div>{entry.text || t('chat.reasoningThinking')}</div>
      </details>
    );
  if (entry.kind === 'search')
    return (
      <MessageBubble
        message={{
          id: entry.id,
          role: 'assistant',
          content: '',
          web_searched: true,
          web_search_actions: entry.actions,
        }}
      />
    );
  return entry.tool.name === 'todo_write' ? (
    <ToolCardDispatcher record={toolRecord(entry.tool)} />
  ) : (
    <ToolTimeline items={[entry.tool]} />
  );
}
