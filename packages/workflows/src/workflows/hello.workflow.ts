import { condition, log, proxyActivities, setHandler } from '@temporalio/workflow';
import type { Activities } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';
import { getStatusQuery, skipDelaySignal } from '../definitions.js';

const { printMessage } = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
  retry: DEFAULT_RETRY_POLICY,
});

export interface HelloWorkflowResult {
  greeting: string;
  farewell: string;
  skipped: boolean;
}

/**
 * Smallest possible end-to-end example: one activity call, one durable
 * timer, one signal, one query. Greets, waits up to 30s (or until the
 * skipDelay signal arrives), then says goodbye.
 */
export async function helloWorkflow(name: string): Promise<HelloWorkflowResult> {
  let status = 'greeting';
  let skipRequested = false;

  setHandler(getStatusQuery, () => status);
  setHandler(skipDelaySignal, () => {
    skipRequested = true;
  });

  const greeting = await printMessage(`Hello, ${name}!`);

  status = 'waiting';
  log.info('greeting sent — waiting for skipDelay signal or 30s timer');
  // condition() resolves when the predicate turns true or the timeout fires.
  // Both are durable: the workflow survives worker restarts while waiting.
  const skipped = await condition(() => skipRequested, '30 seconds');

  status = 'closing';
  const farewell = await printMessage(`Goodbye, ${name}!`);

  status = 'done';
  return { greeting, farewell, skipped };
}
