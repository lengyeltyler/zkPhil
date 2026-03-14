#!/usr/bin/env node

const REQUIRED_NODE_VERSION = '22.14.0';
const MINIMUM_NODE_MAJOR = 22;

const currentVersion = process.versions?.node || '';
const currentMajor = Number.parseInt(currentVersion.split('.')[0] || '', 10);

if (!Number.isInteger(currentMajor) || currentMajor < MINIMUM_NODE_MAJOR) {
  console.error(
    `ERROR: Node ${REQUIRED_NODE_VERSION} required (minimum supported: >=22.0.0). ` +
      `Detected v${currentVersion || 'unknown'}. ` +
      `Install with: nvm install ${REQUIRED_NODE_VERSION} && nvm use ${REQUIRED_NODE_VERSION}`
  );
  process.exit(1);
}

console.log(`Node ${currentVersion} satisfies the >=22.0.0 runtime requirement.`);
