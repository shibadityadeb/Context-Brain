import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { attempts: 3, backoffMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries until success and reports each retry', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    await expect(withRetry(fn, { attempts: 3, backoffMs: 0, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('throws the last error after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await expect(withRetry(fn, { attempts: 2, backoffMs: 0 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops early when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withRetry(fn, { attempts: 5, backoffMs: 0, shouldRetry: () => false }),
    ).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledOnce();
  });
});
