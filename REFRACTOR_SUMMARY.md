# REFRACTOR_SUMMARY

## What was renamed

- `ProofGateTest13` -> `PhilIdentityGate`
- `PhilTestMint` -> `PhilIdentityMint`
- `allowlistRoot` -> `eligibilityRoot`
- `dropId` -> `contextId` in the active proving and deployment surfaces
- `slot` -> `credentialSlot` in proof metadata and Cairo outputs
- `leaf` -> `credentialLeaf` in proof metadata and Cairo outputs
- `createAllowlistProvider` -> `createEligibilityProvider`
- `cairo/src/allowlist.cairo` -> `cairo/src/eligibility.cairo`

## What was removed

- Backend ECDSA mint authorization as a production trust root
- `ALLOWLIST_SIGNER_KEY` from the authorization path
- Test13-specific naming from the active proof gate and identity mint flow

## Structural changes

- Eligibility is now the abstract authorization primitive.
- Phil minting is treated as identity issuance backed by eligibility proofs.
- Local Cairo + S-two proving remains the proving path.
- Solidity verification remains Ethereum-native through a fact-registry bridge.
- The backend is now a proving-request preparer and optional local registration helper, not an authority.

## What is now generic

- `PhilIdentityGate` verifies eligibility claims against a root plus context, not a named allowlist/drop model.
- Cairo public outputs are phrased in terms of eligibility credentials.
- Frontend copy and proving scripts refer to eligibility and identity issuance.
- Tests exercise eligibility proofs, wrong roots, wrong recipients, nullifier reuse, and bad fact bindings.

## What remains legacy

- Some legacy helper compatibility may still exist in historical or non-active files outside the main proving flow.
- Direct Ethereum onchain verification of S-two proofs is still not implemented; the active bridge is fact-registry-based.
