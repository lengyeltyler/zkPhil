declare module '*eligibilityBundle.mjs' {
  export function getRecipientCredentials(bundle: any, recipient: string): any[];
  export function normalizeAddress(address: string): string;
}

declare module '*localStarkProver.mjs' {
  export function computeClaimHash(params: any): string;
  export function computeActionClaimHash(params: any): string;
  export function encodeProofMetadata(params: {
    nullifier: bigint | string | number;
    credentialSlot: bigint | string | number;
    credentialLeaf: bigint | string | number;
  }): string;
  export function computeLeaf(params: {
    secret: bigint | string | number;
    recipient: bigint | string | number;
    credentialSlot: bigint | string | number;
  }): bigint;
  export function computeNullifier(params: {
    secret: bigint | string | number;
    credentialSlot: bigint | string | number;
    contextId: bigint | string | number;
    recipient: bigint | string | number;
    claimKind: bigint | string | number;
  }): bigint;
  export function buildProofPayload(params: {
    programHash: string;
    contextId: bigint | string | number;
    recipient: string;
    claimHash: string;
    claimKind: number;
    eligibilityRoot: bigint | string | number;
    secret: bigint | string | number;
    credentialSlot: bigint | string | number;
    expiry: bigint | string | number;
  }): {
    expiry: bigint;
    factHash: string;
    signature: string;
    publicOutputs: {
      nullifier: bigint;
      credentialLeaf: bigint;
    };
  };
}
