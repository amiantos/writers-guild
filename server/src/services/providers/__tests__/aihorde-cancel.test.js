import { describe, it, expect, vi } from 'vitest';
import { AIHordeProvider } from '../aihorde-provider.js';

function pollingProvider() {
  const provider = new AIHordeProvider({ apiKey: 'k' });
  provider.pollingInterval = 1000;
  provider.submitRequest = vi.fn(async () => 'req-1');
  provider.checkStatus = vi.fn(async () => ({ finished: false, faulted: false, generations: [] }));
  provider.cancelRequest = vi.fn(async () => {});
  return provider;
}

async function drain(updates) {
  while (!(await updates.next()).done);
}

describe('AIHordeProvider cancellation', () => {
  it('cancels the Horde request when stopped while waiting between polls', async () => {
    const provider = pollingProvider();
    const controller = new AbortController();
    const updates = provider.generateStreamingWithStatus('s', 'u', { signal: controller.signal });

    const running = drain(updates);
    await vi.waitFor(() => expect(provider.checkStatus).toHaveBeenCalled());
    controller.abort();

    await expect(running).rejects.toThrow('Generation cancelled');
    expect(provider.cancelRequest).toHaveBeenCalledWith('req-1');
  });

  it('cancels the Horde request when stopped before a poll', async () => {
    const provider = pollingProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      drain(provider.generateStreamingWithStatus('s', 'u', { signal: controller.signal })),
    ).rejects.toThrow('Generation cancelled');
    expect(provider.cancelRequest).toHaveBeenCalledTimes(1);
  });

  it('cancels a plain generate() when stopped while waiting between polls', async () => {
    const provider = pollingProvider();
    const controller = new AbortController();
    const running = provider.generate('s', 'u', { signal: controller.signal });

    await vi.waitFor(() => expect(provider.checkStatus).toHaveBeenCalled());
    controller.abort();

    await expect(running).rejects.toThrow('Generation cancelled');
    expect(provider.cancelRequest).toHaveBeenCalledWith('req-1');
  });

  it('returns a finished generate() without cancelling it', async () => {
    const provider = pollingProvider();
    provider.checkStatus.mockResolvedValue({
      finished: true,
      faulted: false,
      generations: [{ text: '\nHello', model: 'm' }],
    });

    const result = await provider.generate('s', 'u', { signal: new AbortController().signal });
    expect(result.content).toBe('Hello');
    expect(provider.cancelRequest).not.toHaveBeenCalled();
  });
});
