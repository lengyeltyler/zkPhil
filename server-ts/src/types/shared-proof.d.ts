declare module '*credentialBundle.mjs' {
  export function getRecipientCredentials(bundle: any, recipient: string): any[];
  export function normalizeAddress(address: string): string;
  export function buildCredentialBundle(input: any): any;
}

declare module '*localStarkProver.mjs' {
  export function computeClaimHash(params: any): string;
  export function computeActionClaimHash(params: any): string;
  export function encodeProofMetadata(params: {
    identityNullifier: bigint | string | number;
    credentialCommitment: bigint | string | number;
  }): string;
  export function computeCredentialCommitment(params: {
    secret: bigint | string | number;
    recipient: bigint | string | number;
  }): bigint;
  export function computeIdentityNullifier(params: {
    secret: bigint | string | number;
    proofContext: bigint | string | number;
    recipient: bigint | string | number;
    claimKind: bigint | string | number;
  }): bigint;
  export function buildProofPayload(params: {
    programHash: string;
    proofContext: bigint | string | number;
    recipient: string;
    claimHash: string;
    claimKind: number;
    verifierConfigHash: bigint | string | number;
    secret: bigint | string | number;
    expiry: bigint | string | number;
  }): {
    expiry: bigint;
    factHash: string;
    signature: string;
    publicOutputs: {
      identityNullifier: bigint;
      credentialCommitment: bigint;
    };
  };
}
