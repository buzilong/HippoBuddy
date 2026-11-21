import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ProcessSection } from '@/components/chat-panel/ProcessSection';

const props = {
  collapsed: false,
  onToggle: vi.fn(),
  hasThinking: true,
  toolCount: 2,
  elapsedMs: 1000,
};

describe('ProcessSection full/result modes', () => {
  it('renders an expanded full process and a controlled collapsed result view', () => {
    const { container, rerender } = render(<ProcessSection {...props}>details</ProcessSection>);
    const summary = () => container.querySelector('.process-summary')!;
    expect(container.firstChild).not.toHaveClass('collapsed');
    expect(summary()).toHaveAttribute('aria-expanded', 'true');
    rerender(
      <ProcessSection {...props} collapsed>
        details
      </ProcessSection>,
    );
    expect(container.firstChild).toHaveClass('collapsed');
    expect(summary()).toHaveAttribute('aria-expanded', 'false');
    rerender(<ProcessSection {...props}>details</ProcessSection>);
    expect(container.firstChild).not.toHaveClass('collapsed');
  });

  it('delegates mouse and keyboard toggles to the round state', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <ProcessSection {...props} onToggle={onToggle}>
        details
      </ProcessSection>,
    );
    const summary = container.querySelector('.process-summary')!;
    fireEvent.click(summary);
    fireEvent.keyDown(summary, { key: 'Enter' });
    fireEvent.keyDown(summary, { key: ' ' });
    fireEvent.keyDown(summary, { key: 'ArrowDown' });
    expect(onToggle).toHaveBeenCalledTimes(3);
    // The parent owns the collapsed state; callbacks must not create local overrides.
    expect(summary).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows processing/completed summaries without remounting the round', () => {
    const { container, rerender } = render(
      <ProcessSection {...props} streaming>
        <div className="round-final-text">answer</div>
      </ProcessSection>,
    );
    const root = container.firstChild;
    expect(container.querySelector('.process-summary')).toHaveTextContent('处理中');
    rerender(
      <ProcessSection {...props} collapsed>
        <div className="round-final-text">answer</div>
      </ProcessSection>,
    );
    expect(container.firstChild).toBe(root);
    expect(container.querySelector('.process-summary')).toHaveTextContent('本次处理');
    expect(container.querySelector('.round-final-text')).toHaveTextContent('answer');
  });

  it('omits unavailable timing and thinking metadata', () => {
    const { container } = render(
      <ProcessSection {...props} hasThinking={false} elapsedMs={null}>
        details
      </ProcessSection>,
    );
    const summary = container.querySelector('.process-summary')!;
    expect(summary).toHaveTextContent('2 个工具');
    expect(summary).not.toHaveTextContent('总耗时');
    expect(summary).not.toHaveTextContent('本次处理');
  });
});
