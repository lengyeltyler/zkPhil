# HUMANITY_READY_SUMMARY

## What is now in place

- `PhilIdentityGate` remains the shared identity/nullifier gate.
- `IHumanityVerifier` remains the provider abstraction.
- the current bridge remains fact-registry-based.
- local Cairo + S-two proving remains the core proving path.
- stable Sepolia trait/data reuse now has a tracked manifest at [`config/stable-art-backends/sepolia.json`](./config/stable-art-backends/sepolia.json).

## New dev/test capability

The repo now has a clearly isolated mock-humanity testing mode:

- verifier contract: [`contracts/proofs/MockHumanityVerifier.sol`](./contracts/proofs/MockHumanityVerifier.sol)
- bundle builder: [`shared/proof/mockHumanityBundle.mjs`](./shared/proof/mockHumanityBundle.mjs)
- bundle script: [`scripts/proofs/build_mock_humanity_bundle.mjs`](./scripts/proofs/build_mock_humanity_bundle.mjs)
- committed sample humans: [`fixtures/mock_humans.dev.json`](./fixtures/mock_humans.dev.json)

This mode is DEV/TEST ONLY.
It is not World ID.

## What mock-humanity mode simulates

- `mockHumanId`
- `humanitySecret`
- deterministic `identityNullifier`
- recipient-bound claim hashes
- one-human-one-identity nullifier semantics

## What stayed stable

- the Cairo public output shape
- fact-hash computation shape
- `MintProof.signature = abi.encode(identityNullifier, credentialCommitment)`
- backend non-authoritative role
- smart-account mint binding semantics
- Sepolia art/data contracts can now be reused independently of mutable identity/account deployments

## Local workflow hardening

- `scripts/run_local_e2e.sh` now distinguishes local art reuse vs full local art bootstrap
- deploy scripts now use bounded RPC retry/backoff instead of one-shot JSON-RPC calls
- readiness checks now cover RPC, art backend manifest health, Stark core, 4337, backend, and prover
- proof bundles now live under `generated/proofs/`
- local helper runs pin a Node 22 runtime for backend/prover work

## Intentionally still unimplemented

- World / World ID integration
- any external proof-of-human API calls
- direct onchain Ethereum verification of S-two proof artifacts
