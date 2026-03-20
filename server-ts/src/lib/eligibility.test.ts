import { describe, expect, it } from 'vitest';

import { createEligibilityProvider } from './eligibility.js';

describe('eligibility bundle guardrails', () => {
  it('requires CREDENTIAL_BUNDLE_PATH in local proving mode', () => {
    expect(() =>
      createEligibilityProvider({
        env: {} as NodeJS.ProcessEnv,
        isNullifierSpent: async () => false,
      })
    ).toThrow(/CREDENTIAL_BUNDLE_PATH/);
  });

  it('rejects mock-humanity mode in production', () => {
    expect(() =>
      createEligibilityProvider({
        env: {
          HUMANITY_PROVIDER: 'mock',
          NODE_ENV: 'production',
          CHAIN_ID: '31337',
        } as NodeJS.ProcessEnv,
        isNullifierSpent: async () => false,
      })
    ).toThrow(/DEV\/TEST ONLY/);
  });
});
