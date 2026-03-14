import { describe, expect, it } from 'vitest';

import {
  assertAddressBinding,
  assertEnabledBinding,
  assertSafeHostBinding,
  isCorsOriginAllowed,
} from './index.js';

describe('backend startup policy', () => {
  it('refuses non-loopback HOST in production unless explicitly overridden', () => {
    expect(() =>
      assertSafeHostBinding({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        UNSAFE_NONLOOPBACK_OK: 'false',
      } as NodeJS.ProcessEnv)
    ).toThrow(/Refusing to bind production backend/);

    expect(() =>
      assertSafeHostBinding({
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        UNSAFE_NONLOOPBACK_OK: 'false',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('defines explicit CORS behavior for browser and non-browser callers', () => {
    const prodEnv = {
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://mint.example',
      ALLOW_LOOPBACK_ORIGINS: 'false',
    } as NodeJS.ProcessEnv;

    expect(isCorsOriginAllowed(undefined, prodEnv)).toBe(true);
    expect(isCorsOriginAllowed('https://mint.example', prodEnv)).toBe(true);
    expect(isCorsOriginAllowed('https://evil.example', prodEnv)).toBe(false);
    expect(isCorsOriginAllowed('http://localhost:5173', prodEnv)).toBe(false);
  });

  it('fails closed on mismatched critical on-chain address bindings', () => {
    expect(() =>
      assertAddressBinding(
        'PHIL_PAYMASTER.verifyingSigner()',
        '0x1000000000000000000000000000000000000001',
        '0x2000000000000000000000000000000000000002'
      )
    ).toThrow(/PHIL_PAYMASTER\.verifyingSigner\(\) mismatch/);

    expect(() =>
      assertAddressBinding(
        'PHIL_PAYMASTER.verifyingSigner()',
        '0x1000000000000000000000000000000000000001',
        '0x1000000000000000000000000000000000000001'
      )
    ).not.toThrow();
  });

  it('fails closed when a required proof gate authorization is missing', () => {
    expect(() =>
      assertEnabledBinding('ProofGate.authorizedCaller(PHIL_ACCOUNT_FACTORY)', false)
    ).toThrow(/must be enabled/);

    expect(() =>
      assertEnabledBinding('ProofGate.authorizedCaller(PHIL_ACCOUNT_FACTORY)', true)
    ).not.toThrow();
  });
});
