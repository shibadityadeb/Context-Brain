/**
 * Standard envelope returned by every API endpoint.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T | null;
  errors: ApiError[] | null;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  /** Dot-path of the offending field for validation errors, e.g. "body.email". */
  field?: string;
}

export interface PaginationQuery {
  page: number;
  limit: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type ServiceStatus = 'up' | 'down';

export interface HealthReport {
  status: 'healthy' | 'degraded';
  uptimeSeconds: number;
  services: {
    api: ServiceStatus;
    database: ServiceStatus;
    redis: ServiceStatus;
    storage: ServiceStatus;
    vector: ServiceStatus;
    queue: ServiceStatus;
  };
}
