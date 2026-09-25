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
});
