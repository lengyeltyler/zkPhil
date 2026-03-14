import { runDeployCli } from './scripts/deploy.mjs';

runDeployCli().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
