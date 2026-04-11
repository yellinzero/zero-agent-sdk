/**
 * @experimental Native SSE (Server-Sent Events) transport for MCP.
 * Provides direct SSE connection without requiring @modelcontextprotocol/sdk.
 *
 * WARNING: This module is experimental and not yet wired into the main MCP client.
 * It may change or be removed in future versions.
 *
 * Features:
 * - Incremental SSE frame parsing
 * - Last-Event-ID reconnection support
 * - HTTP POST for requests with exponential backoff retry
 */

import { AgentError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// SSE Frame Parser
// ---------------------------------------------------------------------------

interface SSEFrame {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Incremental SSE frame parser.
 * Processes raw text stream into structured SSE frames.
 */
export function parseSSEFrames(buffer: string): { frames: SSEFrame[]; remaining: string } {
  const frames: SSEFrame[] = [];
  let remaining = buffer;

  while (true) {
    const frameEnd = remaining.indexOf('\n\n');
    if (frameEnd === -1) break;

    const rawFrame = remaining.slice(0, frameEnd);
    remaining = remaining.slice(frameEnd + 2);

    const frame: SSEFrame = { data: '' };
    const dataLines: string[] = [];

    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) {
        frame.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      } else if (line.startsWith('id:')) {
        frame.id = line.slice(3).trim();
      } else if (line.startsWith('retry:')) {
        const val = parseInt(line.slice(6).trim(), 10);
        if (!Number.isNaN(val)) frame.retry = val;
      }
    }

    frame.data = dataLines.join('\n');
    if (frame.data || frame.event) {
      frames.push(frame);
    }
  }

  return { frames, remaining };
}

// ---------------------------------------------------------------------------
// JSON-RPC Types
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// SSE Transport
// ---------------------------------------------------------------------------

export interface SSETransportOptions {
  /** SSE endpoint URL */
  url: string;
  /** HTTP headers for connections */
  headers?: Record<string, string>;
  /** Maximum reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base reconnection delay in ms (default: 1000) */
  reconnectDelayMs?: number;
  /** Request timeout in ms (default: 30000) */
  requestTimeoutMs?: number;
}

export class SSETransport {
  private url: string;
  private headers: Record<string, string>;
  private maxReconnectAttempts: number;
  private reconnectDelayMs: number;
  private requestTimeoutMs: number;

  private abortController: AbortController | null = null;
  private lastEventId: string | undefined;
  private postEndpoint: string | null = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number | string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private connected = false;

  constructor(options: SSETransportOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  /**
   * Connect to the SSE endpoint and start reading events.
   * The endpoint should return an SSE stream with JSON-RPC messages.
   */
  async connect(): Promise<void> {
    this.abortController = new AbortController();
    await this.startSSEStream();
    this.connected = true;
  }

  private async startSSEStream(): Promise<void> {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...this.headers,
    };

    if (this.lastEventId) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    const response = await fetch(this.url, {
      headers,
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new AgentError(
        `SSE connection failed: ${response.status} ${response.statusText}`,
        'MCP_ERROR'
      );
    }

    if (!response.body) {
      throw new AgentError('SSE response has no body', 'MCP_ERROR');
    }

    // Check for endpoint header (MCP convention)
    const endpoint = response.headers.get('x-mcp-endpoint');
    if (endpoint) {
      this.postEndpoint = new URL(endpoint, this.url).toString();
    }

    // Start reading SSE stream in background
    this.readStream(response.body).catch(() => {
      // Stream ended or errored — will be handled by reconnection
    });
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { frames, remaining } = parseSSEFrames(buffer);
        buffer = remaining;

        for (const frame of frames) {
          if (frame.id) {
            this.lastEventId = frame.id;
          }

          if (frame.event === 'endpoint') {
            // Server provided the POST endpoint
            this.postEndpoint = new URL(frame.data, this.url).toString();
            continue;
          }

          if (frame.event === 'message' || !frame.event) {
            try {
              const msg = JSON.parse(frame.data) as JsonRpcMessage;
              this.handleMessage(msg);
            } catch {
              // Skip non-JSON frames
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      // Response to a request
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`MCP error: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  /**
   * Send a JSON-RPC request via HTTP POST.
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.postEndpoint) {
      throw new AgentError('SSE transport: POST endpoint not yet discovered', 'MCP_ERROR');
    }

    const id = this.nextId++;
    const body: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP SSE request timed out: ${method}`));
        }
      }, this.requestTimeoutMs);

      this.postWithRetry(body)
        .then(() => {
          // Response will come via SSE stream
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          reject(error);
        });
    });
  }

  private async postWithRetry(body: JsonRpcMessage, maxRetries = 3): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.postEndpoint!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.headers,
          },
          body: JSON.stringify(body),
          signal: this.abortController?.signal,
        });

        if (response.ok || response.status === 202) return;

        if (response.status >= 500 && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, this.reconnectDelayMs * 2 ** attempt));
          continue;
        }

        throw new AgentError(
          `MCP POST failed: ${response.status} ${response.statusText}`,
          'MCP_ERROR'
        );
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise((r) => setTimeout(r, this.reconnectDelayMs * 2 ** attempt));
      }
    }
  }

  async close(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    this.connected = false;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('SSE transport closed'));
    }
    this.pendingRequests.clear();
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

// ---------------------------------------------------------------------------
// WebSocket Transport
// ---------------------------------------------------------------------------

export interface WebSocketTransportOptions {
  url: string;
  headers?: Record<string, string>;
  pingIntervalMs?: number;
  requestTimeoutMs?: number;
}

export class WebSocketTransport {
  private url: string;
  private headers: Record<string, string>;
  private pingIntervalMs: number;
  private requestTimeoutMs: number;

  private ws: any = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number | string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private connected = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.pingIntervalMs = options.pingIntervalMs ?? 30_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async connect(): Promise<void> {
    let WebSocket: any;
    try {
      // @ts-expect-error — optional peer dependency, loaded at runtime
      const wsModule = await import('ws');
      WebSocket = wsModule.default ?? wsModule.WebSocket ?? wsModule;
    } catch {
      throw new AgentError(
        'WebSocket transport requires the "ws" package. Install with: npm install ws',
        'MCP_ERROR'
      );
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        headers: this.headers,
      });

      this.ws.on('open', () => {
        this.connected = true;
        this.startPingPong();
        resolve();
      });

      this.ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString()) as JsonRpcMessage;
          this.handleMessage(msg);
        } catch {
          // Ignore non-JSON messages
        }
      });

      this.ws.on('error', (err: any) => {
        if (!this.connected) {
          reject(err);
        }
        for (const [, pending] of this.pendingRequests) {
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        }
        this.pendingRequests.clear();
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.stopPingPong();
        const err = new Error('WebSocket closed');
        for (const [, pending] of this.pendingRequests) {
          pending.reject(err);
        }
        this.pendingRequests.clear();
      });
    });
  }

  private startPingPong(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.ws.ping();
      }
    }, this.pingIntervalMs);
  }

  private stopPingPong(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`MCP error: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new AgentError('WebSocket not connected', 'MCP_ERROR');
    }

    const id = this.nextId++;
    const body: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.ws!.send(JSON.stringify(body), (err: any) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP WebSocket request timed out: ${method}`));
        }
      }, this.requestTimeoutMs);
    });
  }

  async close(): Promise<void> {
    this.stopPingPong();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('WebSocket transport closed'));
    }
    this.pendingRequests.clear();
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
