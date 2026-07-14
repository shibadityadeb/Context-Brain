import { proxyActivities, setHandler } from '@temporalio/workflow';
import type { Activities, ServiceHealthReport } from '@company-brain/activities';
import { QUICK_RETRY_POLICY } from '../retry-policies.js';
import { getReportQuery } from '../definitions.js';

const { checkServices } = proxyActivities<Activities>({
  startToCloseTimeout: '15 seconds',
  retry: QUICK_RETRY_POLICY,
});

/**
 * Probes every platform dependency through an activity. The report is
 * queryable while the workflow is still running and becomes the result.
 */
export async function healthCheckWorkflow(): Promise<ServiceHealthReport> {
  let report: ServiceHealthReport | null = null;
  setHandler(getReportQuery, () => report);

  report = await checkServices();
  return report;
}
