import { describe, expect, it } from 'vitest';

import { createAllowlistProvider } from './allowlist.js';
import { PhilDatabase } from './db.js';

describe('allowlist mode guardrails', () => {
  it('refuses unsafe_dev mode unless explicitly enabled', () => {
    const db = new PhilDatabase(':memory:');
    try {
      expect(() =>
        createAllowlistProvider({
          db,
          env: {
            ALLOWLIST_MODE: 'unsafe_dev',
            UNSAFE_DEV_ALLOWLIST: 'false',
          } as NodeJS.ProcessEnv,
        })
      ).toThrow(/UNSAFE_DEV_ALLOWLIST=true/);
    } finally {
      db.close();
    }
  });
});
