/**
 * Structured tracing — Perfetto Chrome Trace Event format.
 *
 * Outputs traces compatible with:
 * - Perfetto UI (https://ui.perfetto.dev/)
 * - Chrome DevTools trace viewer (chrome://tracing)
 *
 * Spans are hierarchical and can be nested. Each span records
 * duration, metadata, and parent-child relationships.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, unknown>;
  category?: string;
}

/** Chrome Trace Event format (Perfetto-compatible) */
interface ChromeTraceEvent {
  /** Event name */
  name: string;
  /** Category */
  cat: string;
  /** Phase: B=begin, E=end, X=complete, i=instant */
  ph: 'B' | 'E' | 'X' | 'i';
  /** Timestamp in microseconds */
  ts: number;
  /** Duration in microseconds (for X phase) */
  dur?: number;
  /** Process ID */
  pid: number;
  /** Thread ID (using span hierarchy) */
  tid: number;
  /** Arguments / metadata */
  args?: Record<string, unknown>;
  /** Unique ID (for async events) */
  id?: string;
}

export interface TracerConfig {
  /** Session/trace identifier */
  sessionId?: string;
  /** Whether to enable tracing (default: false) */
  enabled?: boolean;
  /** Output file path (default: ~/.zero/traces/trace-<sessionId>.json) */
  outputPath?: string;
  /** Callback for real-time span events */
  onSpan?: (span: TraceSpan) => void;
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

let spanIdCounter = 0;

function generateSpanId(): string {
  return `span_${++spanIdCounter}_${Date.now().toString(36)}`;
}

export class Tracer {
  readonly traceId: string;
  readonly sessionId: string;
  private enabled: boolean;
  private outputPath?: string;
  private onSpan?: (span: TraceSpan) => void;
  private events: ChromeTraceEvent[] = [];
  private activeSpans = new Map<string, TraceSpan>();
  private spanThreadMap = new Map<string, number>();
  private nextThreadId = 1;

  constructor(config?: TracerConfig) {
    this.sessionId = config?.sessionId ?? randomUUID();
    this.traceId = this.sessionId;
    this.enabled = config?.enabled ?? false;
    this.outputPath = config?.outputPath;
    this.onSpan = config?.onSpan;
  }

  /**
   * Start a new span.
   * Returns the span ID. Call endSpan() when the operation completes.
   */
  span(
    name: string,
    options?: {
      parentSpanId?: string;
      category?: string;
      attributes?: Record<string, unknown>;
    }
  ): string {
    if (!this.enabled) return '';

    const spanId = generateSpanId();
    const now = performance.now() * 1000; // Convert to microseconds

    const span: TraceSpan = {
      traceId: this.traceId,
      spanId,
      parentSpanId: options?.parentSpanId,
      name,
      startTime: now,
      attributes: options?.attributes,
      category: options?.category ?? 'default',
    };

    this.activeSpans.set(spanId, span);

    // Assign thread ID based on parent
    const parentTid = options?.parentSpanId
      ? (this.spanThreadMap.get(options.parentSpanId) ?? 0)
      : 0;
    const tid = options?.parentSpanId ? parentTid : this.nextThreadId++;
    this.spanThreadMap.set(spanId, tid);

    // Emit begin event
    this.events.push({
      name,
      cat: span.category ?? 'default',
      ph: 'B',
      ts: now,
      pid: 1,
      tid,
      args: options?.attributes,
      id: spanId,
    });

    return spanId;
  }

  /**
   * End a span and record its duration.
   */
  endSpan(spanId: string, attributes?: Record<string, unknown>): TraceSpan | undefined {
    if (!this.enabled || !spanId) return undefined;

    const span = this.activeSpans.get(spanId);
    if (!span) return undefined;

    const now = performance.now() * 1000;
    span.endTime = now;

    if (attributes) {
      span.attributes = { ...span.attributes, ...attributes };
    }

    this.activeSpans.delete(spanId);

    const tid = this.spanThreadMap.get(spanId) ?? 0;

    // Emit end event
    this.events.push({
      name: span.name,
      cat: span.category ?? 'default',
      ph: 'E',
      ts: now,
      pid: 1,
      tid,
      args: attributes,
      id: spanId,
    });

    this.onSpan?.(span);
    return span;
  }

  /**
   * Record an instant event (no duration).
   */
  instant(name: string, attributes?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const now = performance.now() * 1000;
    this.events.push({
      name,
      cat: 'instant',
      ph: 'i',
      ts: now,
      pid: 1,
      tid: 0,
      args: attributes,
    });
  }

  /**
   * Get all collected trace events in Chrome Trace Event format.
   */
  getEvents(): ChromeTraceEvent[] {
    return [...this.events];
  }

  /**
   * Export traces as a Perfetto-compatible JSON string.
   */
  toJSON(): string {
    return JSON.stringify({
      traceEvents: this.events,
      metadata: {
        sessionId: this.sessionId,
        traceId: this.traceId,
      },
    });
  }

  /**
   * Write trace output to file.
   */
  async flush(): Promise<string | undefined> {
    if (!this.enabled || this.events.length === 0) return undefined;

    const { mkdir, writeFile } = await import('node:fs/promises');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');

    const outputPath =
      this.outputPath ?? join(homedir(), '.zero', 'traces', `trace-${this.sessionId}.json`);

    const dir = outputPath.substring(0, outputPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(outputPath, this.toJSON(), 'utf-8');

    return outputPath;
  }

  /**
   * Reset the tracer, clearing all collected events.
   */
  reset(): void {
    this.events.length = 0;
    this.activeSpans.clear();
    this.spanThreadMap.clear();
    this.nextThreadId = 1;
  }
}

// ---------------------------------------------------------------------------
// Convenience: create a tracer
// ---------------------------------------------------------------------------

/**
 * Create a tracer instance.
 */
export function createTracer(config?: TracerConfig): Tracer {
  return new Tracer(config);
}

// ---------------------------------------------------------------------------
// Event augmentation
// ---------------------------------------------------------------------------

/**
 * Span info that can be attached to AgentEvents.
 */
export interface SpanInfo {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp: number;
}
