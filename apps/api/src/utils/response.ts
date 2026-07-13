import type { ApiError, ApiResponse } from '@company-brain/types';

/** Build a success envelope. */
export function ok<T>(data: T, message = 'OK'): ApiResponse<T> {
  return {
    success: true,
    message,
    data,
    errors: null,
    timestamp: new Date().toISOString(),
  };
}

/** Build a failure envelope. */
export function fail(message: string, errors: ApiError[]): ApiResponse<null> {
  return {
    success: false,
    message,
    data: null,
    errors,
    timestamp: new Date().toISOString(),
  };
}
