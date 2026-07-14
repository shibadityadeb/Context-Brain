'use client';

import { useEffect, useState } from 'react';
import type { HealthReport } from '@company-brain/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@company-brain/ui';
import { useAuth } from '@/components/auth-provider';
import { api } from '@/lib/api';

const SERVICE_LABELS: Record<keyof HealthReport['services'], string> = {
  api: 'API',
  database: 'PostgreSQL',
  redis: 'Redis',
  storage: 'MinIO',
  vector: 'Qdrant',
  queue: 'Queue',
  temporal: 'Temporal',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    api
      .getHealth()
      .then(setHealth)
      .catch(() => setHealthError(true));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.name}. Platform status at a glance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">System health</CardTitle>
          <CardDescription>
            {health
              ? `Status: ${health.status} · uptime ${health.uptimeSeconds}s`
              : healthError
                ? 'Health endpoint unreachable'
                : 'Checking…'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(SERVICE_LABELS) as (keyof HealthReport['services'])[]).map((key) => {
              const status = health?.services[key];
              return (
                <div key={key} className="rounded-lg border p-4">
                  <p className="text-sm font-medium">{SERVICE_LABELS[key]}</p>
                  <p
                    className={cn(
                      'mt-1 text-sm',
                      status === 'up'
                        ? 'text-green-600 dark:text-green-500'
                        : status === 'down'
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                    )}
                  >
                    {status ?? '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your role</CardTitle>
            <CardDescription>Access level in this workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{user?.role}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">What&apos;s next</CardTitle>
            <CardDescription>Phase 0 foundation is live</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Upcoming phases plug into this platform: meeting intelligence, company memory, task
            tracking and integrations.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
