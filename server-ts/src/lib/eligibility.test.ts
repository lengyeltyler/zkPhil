import { describe, expect, it } from 'vitest';

import { createEligibilityProvider } from './eligibility.js';

describe('eligibility bundle guardrails', () => {
  it('requires ELIGIBILITY_BUNDLE_PATH in local proving mode', () => {
    expect(() =>
      createEligibilityProvider({
        env: {} as NodeJS.ProcessEnv,
        isNullifierSpent: async () => false,
      })
    ).toThrow(/ELIGIBILITY_BUNDLE_PATH/);
  });
});
