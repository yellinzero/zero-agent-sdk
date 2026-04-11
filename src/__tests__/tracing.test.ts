/**
 * Tests for the tracing module.
 */

import { describe, expect, it } from 'vitest';
import { parseSSEFrames } from '../mcp/native-transports.js';
import { createTracer } from '../tracing/tracer.js';

describe('Tracer', () => {
  it('should create a tracer with session ID', () => {
    const tracer = createTracer({ sessionId: 'test-session', enabled: true });
    expect(tracer.sessionId).toBe('test-session');
    expect(tracer.traceId).toBe('test-session');
  });

  it('should not record spans when disabled', () => {
    const tracer = createTracer({ enabled: false });
    const spanId = tracer.span('test');
    expect(spanId).toBe('');
    expect(tracer.getEvents()).toHaveLength(0);
  });

  it('should record span begin and end events', () => {
    const tracer = createTracer({ enabled: true });
    const spanId = tracer.span('test-operation', { category: 'tool' });
    expect(spanId).not.toBe('');

    tracer.endSpan(spanId, { result: 'success' });
    const events = tracer.getEvents();

    expect(events).toHaveLength(2);
    expect(events[0]!.ph).toBe('B');
    expect(events[0]!.name).toBe('test-operation');
    expect(events[1]!.ph).toBe('E');
    expect(events[1]!.args).toEqual({ result: 'success' });
  });

  it('should record instant events', () => {
    const tracer = createTracer({ enabled: true });
    tracer.instant('checkpoint', { step: 1 });

    const events = tracer.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.ph).toBe('i');
    expect(events[0]!.name).toBe('checkpoint');
  });

  it('should output Perfetto-compatible JSON', () => {
    const tracer = createTracer({ sessionId: 'test', enabled: true });
    tracer.instant('test-event');

    const json = tracer.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed.traceEvents).toBeDefined();
    expect(parsed.metadata.sessionId).toBe('test');
  });

  it('should support nested spans', () => {
    const tracer = createTracer({ enabled: true });
    const parentId = tracer.span('parent');
    const childId = tracer.span('child', { parentSpanId: parentId });

    tracer.endSpan(childId);
    tracer.endSpan(parentId);

    const events = tracer.getEvents();
    expect(events).toHaveLength(4); // 2 begins + 2 ends
  });

  it('should call onSpan callback when span ends', () => {
    const spans: any[] = [];
    const tracer = createTracer({
      enabled: true,
      onSpan: (span) => spans.push(span),
    });

    const spanId = tracer.span('tracked');
    tracer.endSpan(spanId);

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('tracked');
    expect(spans[0].endTime).toBeDefined();
  });

  it('should reset tracer', () => {
    const tracer = createTracer({ enabled: true });
    tracer.instant('event-1');
    tracer.instant('event-2');
    expect(tracer.getEvents()).toHaveLength(2);

    tracer.reset();
    expect(tracer.getEvents()).toHaveLength(0);
  });
});
