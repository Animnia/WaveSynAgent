import { describe, it, expect } from 'vitest';
import { appendPart, type MessagePart } from './agentStore';

/**
 * The assistant-message timeline: reasoning blocks, text segments and tool
 * calls interleave in stream order. Consecutive same-kind deltas merge into
 * the tail part; a different kind starts a new part.
 */
describe('appendPart timeline merging', () => {
  it('merges consecutive deltas of the same kind', () => {
    const parts: MessagePart[] = [];
    appendPart(parts, 'reasoning', '想');
    appendPart(parts, 'reasoning', '一想');
    appendPart(parts, 'text', '你好');
    appendPart(parts, 'text', '，世界');
    expect(parts).toEqual([
      { kind: 'reasoning', text: '想一想' },
      { kind: 'text', text: '你好，世界' },
    ]);
  });

  it('starts a new text part after a tool call (interleaving)', () => {
    const parts: MessagePart[] = [];
    appendPart(parts, 'text', '先调滤波');
    parts.push({ kind: 'tool', tool: 'set_params', args: '{}' });
    appendPart(parts, 'text', '已应用');
    expect(parts.map((p) => p.kind)).toEqual(['text', 'tool', 'text']);
    expect((parts[2] as { text: string }).text).toBe('已应用');
  });

  it('reasoning → text → tool → reasoning reproduces the agent loop order', () => {
    const parts: MessagePart[] = [];
    appendPart(parts, 'reasoning', 'r1');
    appendPart(parts, 'text', 't1');
    parts.push({ kind: 'tool', tool: 'set_filter', args: '{"cutoff":800}' });
    appendPart(parts, 'reasoning', 'r2');
    appendPart(parts, 'text', 't2');
    expect(parts.map((p) => p.kind)).toEqual([
      'reasoning',
      'text',
      'tool',
      'reasoning',
      'text',
    ]);
  });
});
