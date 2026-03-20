# REFRACTOR_SUMMARY

## What was renamed

- `ProofGateTest13` -> `PhilIdentityGate`
- `PhilTestMint` -> `PhilIdentityMint`
- `allowlistRoot` -> `eligibilityRoot` in the first refactor, then into the verifier-agnostic `verifierConfigHash`
- `dropId` -> `proofContext`
- `slot` / `leaf` metadata -> `credentialCommitment`
- proof nullifier semantics -> `identityNullifier`
- `cairo/src/allowlist.cairo` -> `cairo/src/credential.cairo`
- `shared/proof/eligibilityBundle.mjs` -> `shared/proof/credentialBundle.mjs`
- `scripts/proofs/build_eligibility_bundle.mjs` -> `scripts/proofs/build_credential_bundle.mjs`

## What was removed

- backend mint-signing authority
- Test13-specific product naming
- tree/slot/list-era proof metadata in the active contract path
- the assumption that Phil issuance is “allowlist membership with a mint attached”

## Structural changes

- `PhilIdentityGate` is now purely the identity/nullifier gate.
- `IHumanityVerifier` is the verifier abstraction for future proof-of-human integrations.
- `FactRegistryHumanityVerifier` is the concrete bridge used today.
- Cairo proof outputs are framed as verifier config + commitment + identity nullifier, not root + slot + leaf.
- the backend only prepares proving requests and helps with dev/local registration.

## What is now generic

- the identity gate can accept future humanity verifiers without contract rewrite
- the proving request format is provider-oriented instead of allowlist-oriented
- the current credential-root model is explicitly treated as an implementation detail
- Phil issuance is modeled as identity creation gated by a unique proof source

## What remains intentionally unimplemented

- direct onchain Ethereum verification of S-two proofs
- World / World ID integration
- any third-party proof-of-personhood API integration
