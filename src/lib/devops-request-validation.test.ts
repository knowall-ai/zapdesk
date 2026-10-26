import { describe, it, expect } from 'vitest';
import {
  validateJsonObject,
  rejectUnknownKeys,
  validateRequiredString,
  validateOptionalString,
  validateOptionalBoolean,
  MAX_WORK_ITEM_ID,
  MAX_PROJECT_LENGTH,
  MAX_STATE_LENGTH,
  MAX_COMMENT_LENGTH,
} from './devops-request-validation';

describe('validateJsonObject', () => {
  it('accepts a plain object', () => {
    const result = validateJsonObject({ foo: 'bar' });
    expect(result).toEqual({ ok: true, data: { foo: 'bar' } });
  });

  it('rejects null', () => {
    const result = validateJsonObject(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('JSON object');
    }
  });

  it('rejects an array', () => {
    const result = validateJsonObject([1, 2, 3]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('rejects a string', () => {
    const result = validateJsonObject('hello');
    expect(result.ok).toBe(false);
  });

  it('rejects a number', () => {
    const result = validateJsonObject(42);
    expect(result.ok).toBe(false);
  });
});

describe('rejectUnknownKeys', () => {
  it('accepts only allowed keys', () => {
    const result = rejectUnknownKeys({ state: 'Active', project: 'P1' }, ['state', 'project']);
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('rejects unexpected keys', () => {
    const result = rejectUnknownKeys({ state: 'Active', evil: 'hack' }, ['state']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('evil');
    }
  });

  it('rejects multiple unknown keys', () => {
    const result = rejectUnknownKeys({ a: 1, b: 2, c: 3 }, ['a']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('b');
      expect(result.error).toContain('c');
    }
  });

  it('accepts empty body', () => {
    const result = rejectUnknownKeys({}, ['state']);
    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe('validateRequiredString', () => {
  it('accepts a valid non-empty string', () => {
    const result = validateRequiredString('Active', 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('Active');
  });

  it('trims whitespace', () => {
    const result = validateRequiredString('  Active  ', 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('Active');
  });

  it('rejects undefined', () => {
    const result = validateRequiredString(undefined, 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('rejects empty string', () => {
    const result = validateRequiredString('', 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    const result = validateRequiredString('   ', 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string type', () => {
    const result = validateRequiredString(123, 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(false);
  });

  it('rejects strings exceeding max length', () => {
    const longString = 'x'.repeat(MAX_STATE_LENGTH + 1);
    const result = validateRequiredString(longString, 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('at most');
  });

  it('accepts string at exactly max length', () => {
    const exactString = 'x'.repeat(MAX_STATE_LENGTH);
    const result = validateRequiredString(exactString, 'state', MAX_STATE_LENGTH);
    expect(result.ok).toBe(true);
  });
});

describe('validateOptionalString', () => {
  it('returns undefined for undefined input', () => {
    const result = validateOptionalString(undefined, 'project', MAX_PROJECT_LENGTH);
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('rejects null input', () => {
    const result = validateOptionalString(null, 'project', MAX_PROJECT_LENGTH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('project must be a string');
    }
  });

  it('accepts a valid string', () => {
    const result = validateOptionalString('MyProject', 'project', MAX_PROJECT_LENGTH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('MyProject');
  });

  it('rejects empty string', () => {
    const result = validateOptionalString('', 'project', MAX_PROJECT_LENGTH);
    expect(result.ok).toBe(false);
  });

  it('rejects non-string type', () => {
    const result = validateOptionalString(42, 'project', MAX_PROJECT_LENGTH);
    expect(result.ok).toBe(false);
  });

  it('rejects overlong string', () => {
    const longString = 'x'.repeat(MAX_PROJECT_LENGTH + 1);
    const result = validateOptionalString(longString, 'project', MAX_PROJECT_LENGTH);
    expect(result.ok).toBe(false);
  });
});

describe('validateOptionalBoolean', () => {
  it('returns undefined for undefined input', () => {
    const result = validateOptionalBoolean(undefined, 'isInternal');
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('rejects null input', () => {
    const result = validateOptionalBoolean(null, 'isInternal');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('isInternal must be a boolean');
    }
  });

  it('accepts true', () => {
    const result = validateOptionalBoolean(true, 'isInternal');
    expect(result).toEqual({ ok: true, data: true });
  });

  it('accepts false', () => {
    const result = validateOptionalBoolean(false, 'isInternal');
    expect(result).toEqual({ ok: true, data: false });
  });

  it('rejects a string', () => {
    const result = validateOptionalBoolean('true', 'isInternal');
    expect(result.ok).toBe(false);
  });

  it('rejects a number', () => {
    const result = validateOptionalBoolean(1, 'isInternal');
    expect(result.ok).toBe(false);
  });
});

describe('constants', () => {
  it('MAX_WORK_ITEM_ID is int32 max', () => {
    expect(MAX_WORK_ITEM_ID).toBe(2_147_483_647);
  });

  it('MAX_PROJECT_LENGTH is 64', () => {
    expect(MAX_PROJECT_LENGTH).toBe(64);
  });

  it('MAX_STATE_LENGTH is 128', () => {
    expect(MAX_STATE_LENGTH).toBe(128);
  });

  it('MAX_COMMENT_LENGTH is 100000', () => {
    expect(MAX_COMMENT_LENGTH).toBe(100_000);
  });
});
