/**
 * SSRF guard — validates URLs before fetch to prevent Server-Side Request Forgery.
 * Blocks access to private IP ranges, cloud metadata endpoints, and non-HTTP schemes.
 */

import { URL } from 'node:url';

// ---------------------------------------------------------------------------
// Blocked hosts
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google.com',
  'metadata.goog',
  // AWS IMDS
  '169.254.169.254',
  'fd00:ec2::254',
  // Azure IMDS
  '169.254.169.253',
  // GCP metadata
  'metadata',
  // Kubernetes
  'kubernetes.default',
  'kubernetes.default.svc',
]);

// ---------------------------------------------------------------------------
// IP range checks
// ---------------------------------------------------------------------------

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;

  const [a, b] = parts as [number, number, number, number];

  // 0.0.0.0/8 — current network
  if (a === 0) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 100.64.0.0/10 — carrier-grade NAT
  if (a === 100 && b! >= 64 && b! <= 127) return true;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 240.0.0.0/4 — reserved
  if (a! >= 240) return true;

  return false;
}

function isBlockedIPv6(ip: string): boolean {
  // Normalize
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');

  // ::1 — loopback (allow for dev, but block by default in SDK context)
  // :: — unspecified
  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — delegate to IPv4 check
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (v4Part.includes('.')) return isBlockedIPv4(v4Part);
  }
  // IPv4-compatible IPv6 (::x.x.x.x) — deprecated but still processed
  if (normalized.startsWith('::') && normalized.includes('.')) {
    const v4Part = normalized.slice(2);
    return isBlockedIPv4(v4Part);
  }

  // fc00::/7 — unique local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // fe80::/10 — link-local
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
    return true;

  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSRFValidationResult {
  allowed: boolean;
  reason?: string;
  /** Resolved IP address (only present when allowed=true and DNS resolution succeeded) */
  resolvedAddress?: string;
  /** IP address family (4 or 6) */
  resolvedFamily?: 4 | 6;
}

export interface SSRFGuardOptions {
  /** Additional hosts to block */
  extraBlockedHosts?: string[];
  /** Allow localhost/loopback for local dev (default: false) */
  allowLocalhost?: boolean;
  /** Allow requests when DNS resolution fails (default: false — deny for production safety) */
  allowDnsFailure?: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a URL for SSRF concerns.
 *
 * Checks performed:
 * 1. URL parsing validity
 * 2. Scheme restriction (HTTP/HTTPS only)
 * 3. Blocked hostname check (metadata endpoints, etc.)
 * 4. DNS resolution and blocked IP range check (prevents TOCTOU via DNS rebinding)
 */
export async function validateUrl(
  rawUrl: string,
  options: SSRFGuardOptions = {}
): Promise<SSRFValidationResult> {
  // 1. Parse URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  // 2. Scheme check
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: `Blocked scheme: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Blocked hosts check
  const allBlockedHosts = options.extraBlockedHosts
    ? new Set([...BLOCKED_HOSTS, ...options.extraBlockedHosts])
    : BLOCKED_HOSTS;

  if (allBlockedHosts.has(hostname)) {
    return { allowed: false, reason: `Blocked host: ${hostname}` };
  }

  // 4. Localhost check
  if (!options.allowLocalhost) {
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0'
    ) {
      return { allowed: false, reason: `Blocked localhost address: ${hostname}` };
    }
  }

  // 5. Resolve DNS and check IP ranges (prevents DNS rebinding)
  try {
    const dns = await import('node:dns/promises');
    const { address, family } = await dns.lookup(hostname);

    if (family === 4 && isBlockedIPv4(address)) {
      return { allowed: false, reason: `Resolved to blocked IP range: ${address}` };
    }
    if (family === 6 && isBlockedIPv6(address)) {
      return { allowed: false, reason: `Resolved to blocked IPv6 range: ${address}` };
    }

    // Return the resolved address so callers can pin the connection to this IP,
    // preventing DNS rebinding TOCTOU attacks where a second DNS lookup could
    // resolve to a different (internal) IP.
    return { allowed: true, resolvedAddress: address, resolvedFamily: family as 4 | 6 };
  } catch {
    // DNS resolution failure — deny by default (conservative for production safety)
    if (options.allowDnsFailure) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'DNS resolution failed for host' };
  }
}
