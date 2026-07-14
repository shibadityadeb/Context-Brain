import { describe, expect, it } from 'vitest';
import {
  connectorIdParamsSchema,
  listLogsQuerySchema,
  listResourcesQuerySchema,
} from '../src/modules/connectors/connector.schemas.js';
import { oauthCallbackQuerySchema } from '../src/modules/auth/auth.schemas.js';

describe('connector API schemas', () => {
  it('validates connector id params', () => {
    expect(() => connectorIdParamsSchema.parse({ connectorId: 'not-a-uuid' })).toThrow();
    expect(
      connectorIdParamsSchema.parse({ connectorId: '0b0e8bde-8b3f-4f26-9d0e-111111111111' }),
    ).toBeTruthy();
  });

  it('accepts partial OAuth callback queries (error-only redirects)', () => {
    expect(oauthCallbackQuerySchema.parse({ error: 'access_denied' })).toMatchObject({
      error: 'access_denied',
    });
    expect(oauthCallbackQuerySchema.parse({ code: 'abc', state: 'xyz' })).toMatchObject({
      code: 'abc',
    });
  });

  it('applies resource list defaults and caps', () => {
    expect(listResourcesQuerySchema.parse({})).toMatchObject({ page: 1, limit: 25 });
    expect(() => listResourcesQuerySchema.parse({ limit: 1000 })).toThrow();
  });

  it('validates log level filters', () => {
    expect(listLogsQuerySchema.parse({ level: 'ERROR' }).level).toBe('ERROR');
    expect(() => listLogsQuerySchema.parse({ level: 'TRACE' })).toThrow();
  });
});
