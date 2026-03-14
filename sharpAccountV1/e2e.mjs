import { runE2E } from './scripts/e2e.mjs';

runE2E().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
