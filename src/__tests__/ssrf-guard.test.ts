/**
 * SSRF guard tests — DNS failure default deny and redirect validation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateUrl } from '../permissions/ssrf-guard.js';

// Mock node:dns/promises
const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: any[]) => mockLookup(...args),
}));

describe('SSRF Guard', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  describe('DNS failure handling', () => {
    it('denies by default when DNS resolution fails', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

      const result = await validateUrl('https://some-host.example.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('DNS resolution failed');
    });

    it('allows when DNS fails if allowDnsFailure is true', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

      const result = await validateUrl('https://some-host.example.com', {
        allowDnsFailure: true,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('blocked IP ranges', () => {
    it('blocks private 10.x.x.x range', async () => {
      mockLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
      const result = await validateUrl('https://some-host.example.com');
      expect(result.allowed).toBe(false);
    });

    it('blocks link-local 169.254.x.x range', async () => {
      mockLookup.mockResolvedValue({ address: '169.254.169.254', family: 4 });
      const result = await validateUrl('https://some-host.example.com');
      expect(result.allowed).toBe(false);
    });

    it('blocks private 192.168.x.x range', async () => {
      mockLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });
      const result = await validateUrl('https://some-host.example.com');
      expect(result.allowed).toBe(false);
    });

    it('allows public IP', async () => {
      mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
      const result = await validateUrl('https://example.com');
      expect(result.allowed).toBe(true);
    });
  });

  describe('scheme restrictions', () => {
    it('blocks non-HTTP schemes', async () => {
      const result = await validateUrl('file:///etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked scheme');
    });

    it('blocks ftp scheme', async () => {
      const result = await validateUrl('ftp://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  describe('blocked hosts', () => {
    it('blocks AWS metadata endpoint', async () => {
      const result = await validateUrl('http://169.254.169.254/latest/meta-data/');
      expect(result.allowed).toBe(false);
    });

    it('blocks GCP metadata host', async () => {
      const result = await validateUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(result.allowed).toBe(false);
    });
  });
});
