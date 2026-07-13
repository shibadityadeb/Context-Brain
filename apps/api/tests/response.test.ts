import { describe, expect, it } from 'vitest';
import { fail, ok } from '../src/utils/response.js';

describe('response envelope', () => {
  it('builds a success envelope', () => {
    const res = ok({ id: 1 }, 'Created');
    expect(res).toMatchObject({ success: true, message: 'Created', data: { id: 1 }, errors: null });
    expect(new Date(res.timestamp).getTime()).not.toBeNaN();
  });

  it('builds a failure envelope', () => {
    const res = fail('Nope', [{ code: 'NOT_FOUND', message: 'missing' }]);
    expect(res).toMatchObject({
      success: false,
      message: 'Nope',
      data: null,
      errors: [{ code: 'NOT_FOUND', message: 'missing' }],
    });
  });
});
