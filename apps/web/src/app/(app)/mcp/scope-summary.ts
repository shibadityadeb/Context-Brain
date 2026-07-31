import type { McpScopeConfig } from '@/lib/api';

/** Human-readable summary of an MCP server's knowledge scope. */
export function scopeSummary(scope: McpScopeConfig): string {
  if (!scope || scope.mode !== 'scoped') return 'Entire workspace';
  const parts: string[] = [];
  if (scope.projectIds?.length) parts.push(`${scope.projectIds.length} project(s)`);
  if (scope.memberIds?.length) parts.push(`${scope.memberIds.length} member(s)`);
  if (scope.documentIds?.length) parts.push(`${scope.documentIds.length} document(s)`);
  if (scope.meetingIds?.length) parts.push(`${scope.meetingIds.length} meeting(s)`);
  return parts.length ? parts.join(' · ') : 'Scoped (empty)';
}
