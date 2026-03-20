# REVIEW_PACKET

## Current proof path review

### Previous mint authorization flow

Before the proving migration and this eligibility refactor, zkPhil mint authorization depended on a backend signer and a Test13-style allowlist model:

1. The client authenticated with `server-ts`.
2. `POST /request-mint` returned `{ expiry, factHash, signature }`.
3. `ProofGateTest13` verified a backend ECDSA signature over a claim hash.
4. Mint authorization therefore depended on custody of `ALLOWLIST_SIGNER_KEY`.

### Backend trust assumptions that existed

- The backend signer decided who could mint.
- The backend signer decided when a proof was valid.
- The backend signer effectively enforced allowlist slot consumption by deciding whether to issue another proof.
- A stolen signer key could authorize arbitrary mints for arbitrary recipients.

### Exact files involved in the old authority path

- `server-ts/src/routes/requestMint.ts`
- `server-ts/src/index.ts`
- `contracts/ProofGateTest13.sol`
- `contracts/PhilTestMint.sol`
- `contracts/PhilAccount.sol`
- `server-ts/src/routes/signPaymaster.ts`
- `.env.example`
- `scripts/verify_sepolia_bindings.mjs`
- `scripts/sepolia/run_all_and_mint_one.mjs`
- `scripts/sepolia/smoke.mjs`
- `scripts/simulate_userop.mjs`

### Existing proof-related pieces that were reusable

- `contracts/proofs/` fact-registry scaffolding
- Cairo workspace under `cairo/`
- shared claim/fact hashing concepts
- `MintProof` surface
- Starknet / 4337 unlock path contracts

## What changed

### New proof architecture

zkPhil now uses local Cairo + S-two proving for generic eligibility:

1. The backend returns a `provingRequest` with recipient-bound witness data from an eligibility bundle.
2. The user device runs Cairo locally through `scarb execute` / `scarb prove`.
3. The prover emits public outputs and a contract proof payload.
4. Solidity accepts only a fact-registry-backed proof for the expected identity claim.

### Authority shift

Removed from the production mint authorization path:

- `ALLOWLIST_SIGNER_KEY`
- backend ECDSA mint approval

Retained as non-authoritative backend responsibilities:

- auth/session handling
- witness distribution
- issued-proof reservation tracking
- local-only fact registration helper on chain `31337`

## Final architecture

### Solidity

- `contracts/PhilIdentityGate.sol`
  - verifies expected fact hashes
  - checks `factRegistry.isValid(factHash)`
  - consumes nullifiers
  - no longer verifies backend signatures
  - is generic over eligibility roots and future credential sources

- `contracts/PhilAccount.sol`
  - auto-approval path now validates proof metadata/fact hash, not signer signatures

- `contracts/PhilPaymaster.sol`
  - sponsorship policy now expects 96-byte proof metadata, not a 65-byte backend signature

### Cairo / proving

- `cairo/src/eligibility.cairo`
  - recipient-bound leaves
  - claim-kind-bound nullifiers
  - public outputs for eligibility root, context id, recipient, claim hash split, nullifier, credential slot, credential leaf, and claim kind

- `scripts/proofs/prove_local.mjs`
  - deterministic local execute/prove wrapper

- `scripts/proofs/local_prover_server.mjs`
  - localhost proof service for frontend/browser flow

- `scripts/proofs/build_eligibility_bundle.mjs`
  - reproducible witness bundle builder

### Server / frontend

- `server-ts/src/routes/requestMint.ts`
  - returns credential-bound `provingRequest`

- `server-ts/src/routes/registerProof.ts`
  - dev-only fact registration bridge on `31337`

- `frontend/mint.js`
  - requests eligibility payloads
  - calls localhost prover
  - registers proof
  - continues the existing mint UX with the same `proof` struct shape

## Files changed

- `contracts/IProofGate.sol`
- `contracts/PhilIdentityGate.sol`
- `contracts/PhilIdentityMint.sol`
- `contracts/proofs/DevProofVerifier.sol`
- `contracts/PhilAccount.sol`
- `contracts/PhilPaymaster.sol`
- `cairo/src/eligibility.cairo`
- `cairo/src/lib.cairo`
- `shared/proof/localStarkProver.mjs`
- `shared/proof/eligibilityBundle.mjs`
- `shared/config/backendCompatibility.mjs`
- `server-ts/src/lib/eligibility.ts`
- `server-ts/src/lib/db.ts`
- `server-ts/src/routes/requestMint.ts`
- `server-ts/src/routes/registerProof.ts`
- `server-ts/src/routes/signPaymaster.ts`
- `server-ts/src/routes/status.ts`
- `server-ts/src/index.ts`
- `frontend/mint.js`
- `scripts/local/deployPhilSystem.mjs`
- `scripts/deploy_stark.mjs`
- `scripts/verify_sepolia_bindings.mjs`
- `.env.example`
- `README.md`
- `docs/ARCHITECTURE.md`

### Files created

- `scripts/proofs/build_eligibility_bundle.mjs`
- `scripts/proofs/prove_local.mjs`
- `scripts/proofs/local_prover_server.mjs`
- `server-ts/src/routes/registerProof.ts`
- `server-ts/src/types/shared-proof.d.ts`
- `test/proof-fixture.mjs`
- `MIGRATION_NOTES.md`

## Security notes

- `PhilIdentityGate` now fails closed on invalid proof metadata, wrong claim binding, missing fact registration, and replayed nullifiers.
- Old backend signature payloads are no longer sufficient.
- Local dev fact registration is isolated to `31337`.
- Public-chain direct onchain S-two verification is not implemented in this repo; the deployed bridge is fact-registry-based.
