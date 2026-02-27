# Security Policy

## Scope

philFresh is a cypherpunk, 100% on-chain NFT project. Security concerns relevant to this project include:

- On-chain proof gate bypass (allowlist circumvention)
- Replay attacks against nullifiers
- SVG/metadata injection or corruption
- Key management failures

## Reporting

For security vulnerabilities, please do NOT open a public issue. Instead, describe the vulnerability in a private message to the project maintainer.

Include:
1. Description of the vulnerability
2. Steps to reproduce
3. Affected components (contract names, function names)
4. Estimated severity (Critical / High / Medium / Low)
5. Suggested remediation if known

## Trust Model

- On-chain contracts are immutable after deployment. Renderer, proof gate, and storage contracts cannot be changed post-deploy.
- The backend proof server is operator-trusted. Compromise of the backend key does not allow minting beyond the nullifier-based on-chain cap.
- The merkle root is pinned at deployment. Allowlist cannot be modified after deployment.
- The paymaster signer is a separate key. Compromise allows free-gas abuse but not unauthorized minting.
- Private keys must NEVER be committed to version control. See `.env.example` for the template.

## Key Rotation

- If the paymaster signer key is compromised: deploy a new `PhilPaymaster` with a new signer; update the backend.
- If the admin/backend key is compromised: revoke proof serving; nullifier burn on-chain prevents double-minting.
- If the deployer key is compromised post-deployment: immutable contracts are unaffected; update backend config only.

## Out of Scope

- Frontend-only UI issues with no on-chain impact
- Gas optimization suggestions (submit as regular issues)
- Third-party library vulnerabilities (report upstream)
