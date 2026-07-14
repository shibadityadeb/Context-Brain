import { proxyActivities } from '@temporalio/workflow';
import type { Activities, UploadFileInput, UploadFileResult } from '@company-brain/activities';
import { DEFAULT_RETRY_POLICY } from '../retry-policies.js';

const { uploadFile } = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: DEFAULT_RETRY_POLICY,
});

/**
 * Uploads a file to object storage via an activity. Template for the
 * document-ingestion pipelines of later phases: the workflow only
 * orchestrates; all I/O lives in retryable activities.
 */
export async function storageWorkflow(input: UploadFileInput): Promise<UploadFileResult> {
  return uploadFile(input);
}
