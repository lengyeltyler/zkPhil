/**
 * Sign Paymaster Route
 *
 * Signs sponsorship approvals for backend-issued mint UserOperations only.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ethers } from 'ethers';
import { PhilDatabase } from '../lib/db.js';
import { computeActionClaimHash, computeProofFactHash } from '../lib/proofHash.js';

interface PackedUserOperationBody {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: string;
  gasFees: string;
}

interface SignPaymasterBody {
  proofId: string;
  userOp: PackedUserOperationBody;
}

interface SignPaymasterResponse {
  success: boolean;
  paymasterAndData?: string;
  validUntil?: number;
  validAfter?: number;
  error?: string;
  code?: string;
}

export interface SignPaymasterConfig {
  paymasterAddress: string;
  paymasterSignerKey: string;
  philTestMintAddress: string;
  proofGateAddress: string;
  allowlistSignerAddress: string;
  philAccountFactoryAddress?: string;
  sponsorshipWindowSec?: number;
  chainId: number;
  db: PhilDatabase;
  provider: ethers.Provider;
}

const ACTION_ACCOUNT_CREATE = 2;
const PAYMASTER_VALIDATION_GAS_LIMIT = 200_000n;
const PAYMASTER_POST_OP_GAS_LIMIT = 50_000n;

const MINT_ABI = [
  'function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
];

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function normalizeAddress(value: string): string {
  return ethers.getAddress(value).toLowerCase();
}

function normalizeBytes32(value: string): string {
  return ethers.zeroPadValue(value, 32).toLowerCase();
}

function normalizeBytes(value: string): string {
  return ethers.hexlify(value).toLowerCase();
}

export default async function signPaymasterRoute(
  fastify: FastifyInstance,
  config: SignPaymasterConfig
) {
  const {
    paymasterAddress,
    paymasterSignerKey,
    philTestMintAddress,
    proofGateAddress,
    allowlistSignerAddress,
    philAccountFactoryAddress,
    sponsorshipWindowSec = 600,
    chainId,
    db,
  } = config;

  const paymaster = ethers.getAddress(paymasterAddress);
  const mintContract = ethers.getAddress(philTestMintAddress);
  const gateAddress = ethers.getAddress(proofGateAddress);
  const backendAllowlistSigner = normalizeAddress(allowlistSignerAddress);
  const factoryAddress = philAccountFactoryAddress
    ? ethers.getAddress(philAccountFactoryAddress)
    : null;
  const paymasterSigner = new ethers.Wallet(paymasterSignerKey);
  const paymasterHashReader = new ethers.Contract(
    paymaster,
    [
      'function getHash((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp, uint128 validUntil, uint128 validAfter) view returns (bytes32)',
    ],
    config.provider
  );
  const paymasterPolicyReader = new ethers.Contract(
    paymaster,
    [
      'function sponsorshipCheckReason((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) view returns (uint8)',
    ],
    config.provider
  );
  const accountFactory = factoryAddress
    ? new ethers.Contract(
        factoryAddress,
        [
          'function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)',
          'function computeCreateActionHash(address owner, uint256 starkPubKeyX) view returns (bytes32)',
        ],
        config.provider
      )
    : null;
  const proofGate = new ethers.Contract(
    gateAddress,
    [
      'function allowlistSigner() view returns (address)',
      'function PROGRAM_HASH() view returns (bytes32)',
      'function DROP_ID() view returns (uint256)',
      'function isMintNullifierSpent(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, bytes32 factHash) view returns (bool)',
      'function isActionNullifierSpent(address recipient, uint8 actionType, bytes32 factHash) view returns (bool)',
    ],
    config.provider
  );
  const executeIface = new ethers.Interface([
    'function execute(address target, uint256 value, bytes data)',
  ]);
  const executeSelector = executeIface.getFunction('execute')!.selector;
  const createAccountIface = new ethers.Interface([
    'function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof)',
  ]);
  const mintIface = new ethers.Interface(MINT_ABI);
  const mintSelector = mintIface.getFunction('mint')!.selector;

  fastify.post<{ Body: SignPaymasterBody }>(
    '/sign-paymaster',
    {
      schema: {
        body: {
          type: 'object',
          required: ['proofId', 'userOp'],
          additionalProperties: false,
          properties: {
            proofId: { type: 'string', minLength: 1, maxLength: 256 },
            userOp: {
              type: 'object',
              required: [
                'sender',
                'nonce',
                'initCode',
                'callData',
                'accountGasLimits',
                'preVerificationGas',
                'gasFees',
              ],
              additionalProperties: false,
              properties: {
                sender: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
                nonce: { type: 'string', pattern: '^0x[a-fA-F0-9]+$|^[0-9]+$' },
                initCode: { type: 'string', pattern: '^0x([a-fA-F0-9]{2})*$' },
                callData: { type: 'string', pattern: '^0x([a-fA-F0-9]{2})+$' },
                accountGasLimits: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
                preVerificationGas: { type: 'string', pattern: '^0x[a-fA-F0-9]+$|^[0-9]+$' },
                gasFees: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: SignPaymasterBody }>,
      reply: FastifyReply
    ): Promise<SignPaymasterResponse> => {
      const now = Math.floor(Date.now() / 1000);
      const authToken = extractBearerToken(request.headers.authorization);
      if (!authToken) {
        return reply.status(401).send({
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Authorization bearer token is required',
        });
      }

      const session = db.getAuthSession(authToken, now);
      if (!session) {
        return reply.status(401).send({
          success: false,
          code: 'AUTH_INVALID',
          error: 'Authorization token is missing, expired, or invalid',
        });
      }

      const proofRecord = db.getIssuedMintProof(request.body.proofId, now);
      if (!proofRecord) {
        return reply.status(404).send({
          success: false,
          code: 'PROOF_ID_INVALID',
          error: 'proofId is missing, expired, or unknown',
        });
      }

      if (proofRecord.paymasterSignedAt != null) {
        return reply.status(409).send({
          success: false,
          code: 'PROOF_ALREADY_SPONSORED',
          error: 'This proof has already been used for paymaster sponsorship',
        });
      }

      if (proofRecord.recipient !== session.recipient) {
        return reply.status(403).send({
          success: false,
          code: 'PROOF_RECIPIENT_MISMATCH',
          error: 'proofId does not belong to the authenticated recipient',
        });
      }

      if (proofRecord.usedAt != null) {
        return reply.status(409).send({
          success: false,
          code: 'MINT_PROOF_ALREADY_USED',
          error: 'This mint proof has already been consumed on-chain',
        });
      }

      const body = request.body.userOp;

      try {
        const sender = normalizeAddress(body.sender);
        const nonce = BigInt(body.nonce);
        const preVerificationGas = BigInt(body.preVerificationGas);
        const initCode = body.initCode as `0x${string}`;
        const callData = body.callData as `0x${string}`;
        const accountGasLimits = body.accountGasLimits as `0x${string}`;
        const gasFees = body.gasFees as `0x${string}`;
        const blankPaymasterUserOp = {
          sender,
          nonce,
          initCode,
          callData,
          accountGasLimits,
          preVerificationGas,
          gasFees,
          paymasterAndData: '0x',
          signature: '0x',
        };

        const currentAllowlistSigner = normalizeAddress(
          String(await proofGate.allowlistSigner())
        );
        if (currentAllowlistSigner !== backendAllowlistSigner) {
          return reply.status(503).send({
            success: false,
            code: 'ALLOWLIST_SIGNER_MISMATCH',
            error: 'Backend allowlist signer no longer matches ProofGate.allowlistSigner()',
          });
        }

        const gateProgramHash = normalizeBytes32(String(await proofGate.PROGRAM_HASH()));
        const gateDropId = BigInt((await proofGate.DROP_ID()).toString());

        const senderCode = await config.provider.getCode(sender);
        const senderExists = senderCode !== '0x';

        if (senderExists) {
          if (initCode !== '0x') {
            return reply.status(400).send({
              success: false,
              code: 'INITCODE_NOT_ALLOWED',
              error: 'initCode must be empty when the smart account is already deployed',
            });
          }
        } else {
          if (!factoryAddress || !accountFactory) {
            return reply.status(500).send({
              success: false,
              code: 'FACTORY_VALIDATION_UNAVAILABLE',
              error: 'Backend cannot validate initCode without PHIL_ACCOUNT_FACTORY and RPC access',
            });
          }
          if (initCode === '0x' || ethers.dataLength(initCode) < 20) {
            return reply.status(400).send({
              success: false,
              code: 'INITCODE_REQUIRED',
              error: 'initCode must deploy the expected smart account when sender has no code',
            });
          }

          const initCodeFactory = normalizeAddress(
            ethers.dataSlice(initCode, 0, 20)
          );
          if (initCodeFactory !== factoryAddress.toLowerCase()) {
            return reply.status(400).send({
              success: false,
              code: 'INITCODE_FACTORY_MISMATCH',
              error: 'initCode must target the configured PhilAccountFactory',
            });
          }

          let initOwner: string;
          let initStarkPubKeyX: bigint;
          let createProofExpiry: bigint;
          let createProofFactHash: string;
          let createProofSignature: string;
          try {
            const decodedInit = createAccountIface.decodeFunctionData(
              'createPhilAccount',
              ethers.hexlify(ethers.dataSlice(initCode, 20))
            );
            initOwner = normalizeAddress(String(decodedInit[0]));
            initStarkPubKeyX = BigInt(decodedInit[1].toString());
            const decodedCreateProof = decodedInit[2] as {
              expiry: bigint;
              factHash: string;
              signature: string;
            };
            createProofExpiry = BigInt(decodedCreateProof.expiry.toString());
            createProofFactHash = normalizeBytes32(String(decodedCreateProof.factHash));
            createProofSignature = normalizeBytes(String(decodedCreateProof.signature));
          } catch {
            return reply.status(400).send({
              success: false,
              code: 'INVALID_INITCODE_ENCODING',
              error: 'initCode is not a valid createPhilAccount(...) payload',
            });
          }

          if (initOwner !== proofRecord.recipient) {
            return reply.status(400).send({
              success: false,
              code: 'INITCODE_OWNER_MISMATCH',
              error: 'initCode owner must match the authenticated proof recipient',
            });
          }

          const predictedSender = normalizeAddress(
            String(await accountFactory.getPhilAddress(initOwner, initStarkPubKeyX))
          );
          if (predictedSender !== sender) {
            return reply.status(400).send({
              success: false,
              code: 'INITCODE_SENDER_MISMATCH',
              error: 'initCode must derive the same sender as the backend-issued smart account',
            });
          }

          if (createProofExpiry !== 0n && createProofExpiry < BigInt(now)) {
            return reply.status(400).send({
              success: false,
              code: 'CREATE_PROOF_EXPIRED',
              error: 'createProof.expiry is already in the past',
            });
          }

          const createActionHash = normalizeBytes32(
            String(await accountFactory.computeCreateActionHash(initOwner, initStarkPubKeyX))
          );
          const createClaimHash = computeActionClaimHash({
            programHash: gateProgramHash,
            dropId: gateDropId,
            chainId: BigInt(chainId),
            proofGateAddress: gateAddress,
            recipient: initOwner,
            actionType: ACTION_ACCOUNT_CREATE,
            actionHash: createActionHash,
            expiry: createProofExpiry,
          });
          const expectedCreateFactHash = computeProofFactHash(createClaimHash);
          if (expectedCreateFactHash !== createProofFactHash) {
            return reply.status(400).send({
              success: false,
              code: 'CREATE_PROOF_FACTHASH_INVALID',
              error: 'createProof.factHash does not match the expected account-create claim hash',
            });
          }

          let recoveredCreateSigner: string;
          try {
            recoveredCreateSigner = normalizeAddress(
              ethers.verifyMessage(ethers.getBytes(createClaimHash), createProofSignature)
            );
          } catch {
            return reply.status(400).send({
              success: false,
              code: 'CREATE_PROOF_SIGNATURE_INVALID',
              error: 'createProof.signature is malformed or invalid',
            });
          }
          if (recoveredCreateSigner !== currentAllowlistSigner) {
            return reply.status(400).send({
              success: false,
              code: 'CREATE_PROOF_SIGNATURE_INVALID',
              error: 'createProof.signature is not valid for the current ProofGate allowlist signer',
            });
          }

          const createProofUsed = Boolean(
            await proofGate.isActionNullifierSpent(
              initOwner,
              ACTION_ACCOUNT_CREATE,
              createProofFactHash
            )
          );
          if (createProofUsed) {
            return reply.status(409).send({
              success: false,
              code: 'CREATE_PROOF_ALREADY_USED',
              error: 'The embedded createProof has already been consumed on-chain',
            });
          }
        }

        if (!callData.startsWith(executeSelector)) {
          return reply.status(400).send({
            success: false,
            code: 'UNSUPPORTED_CALLDATA',
            error: 'Only SmartAccount.execute(...) is eligible for sponsorship',
          });
        }

        let target: string;
        let value: bigint;
        let innerData: string;
        try {
          const decoded = executeIface.decodeFunctionData('execute', callData);
          target = normalizeAddress(String(decoded[0]));
          value = BigInt(decoded[1].toString());
          innerData = String(decoded[2]);
        } catch {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_EXECUTE_ENCODING',
            error: 'callData is not a valid execute(address,uint256,bytes) payload',
          });
        }

        if (target !== mintContract.toLowerCase() || value !== 0n) {
          return reply.status(400).send({
            success: false,
            code: 'UNSUPPORTED_TARGET',
            error: 'Only zero-value calls targeting PhilTestMint are sponsored',
          });
        }

        if (!innerData.startsWith(mintSelector)) {
          return reply.status(400).send({
            success: false,
            code: 'UNSUPPORTED_INNER_CALL',
            error: 'Only PhilTestMint.mint(...) calls are sponsored',
          });
        }

        let mintRecipient: string;
        let mintTo: string;
        let philId: number;
        let paletteVariant: number;
        let mixMode: number;
        let mixSeed: number;
        let proofExpiry: bigint;
        let mintFactHash: string;
        let proofSignature: string;
        try {
          const decodedMint = mintIface.decodeFunctionData('mint', innerData);
          mintRecipient = normalizeAddress(String(decodedMint[0]));
          mintTo = normalizeAddress(String(decodedMint[1]));
          philId = Number(decodedMint[2]);
          paletteVariant = Number(decodedMint[3]);
          mixMode = Number(decodedMint[4]);
          mixSeed = Number(decodedMint[5]);
          const decodedProof = decodedMint[6] as {
            expiry: bigint;
            factHash: string;
            signature: string;
          };
          proofExpiry = BigInt(decodedProof.expiry.toString());
          mintFactHash = normalizeBytes32(String(decodedProof.factHash));
          proofSignature = normalizeBytes(String(decodedProof.signature));
        } catch {
          return reply.status(400).send({
            success: false,
            code: 'INVALID_MINT_ENCODING',
            error: 'Inner calldata is not a valid PhilTestMint.mint(...) payload',
          });
        }

        if (sender !== proofRecord.mintTo || mintTo !== proofRecord.mintTo) {
          return reply.status(400).send({
            success: false,
            code: 'MINT_TO_SENDER_MISMATCH',
            error: 'mintTo and sender must match the backend-issued smart account',
          });
        }

        const userOpMatchesProof =
          mintRecipient === proofRecord.recipient &&
          philId === proofRecord.philId &&
          paletteVariant === proofRecord.paletteVariant &&
          mixMode === proofRecord.mixMode &&
          mixSeed === proofRecord.mixSeed &&
          proofExpiry === BigInt(proofRecord.expiry) &&
          mintFactHash === proofRecord.factHash &&
          proofSignature === proofRecord.signature;

        if (!userOpMatchesProof) {
          return reply.status(400).send({
            success: false,
            code: 'USEROP_PROOF_MISMATCH',
            error: 'userOp.mint calldata does not match the backend-issued proofId',
          });
        }

        if (proofExpiry !== 0n && proofExpiry < BigInt(now)) {
          return reply.status(400).send({
            success: false,
            code: 'EXPIRED_MINT_PROOF',
            error: 'proof.expiry is already in the past',
          });
        }

        const mintProofUsed = Boolean(
          await proofGate.isMintNullifierSpent(
            proofRecord.recipient,
            proofRecord.mintTo,
            proofRecord.philId,
            proofRecord.paletteVariant,
            proofRecord.mixMode,
            proofRecord.mixSeed,
            proofRecord.factHash
          )
        );
        if (mintProofUsed) {
          db.markIssuedMintProofUsed(proofRecord.proofId, now);
          return reply.status(409).send({
            success: false,
            code: 'MINT_PROOF_ALREADY_USED',
            error: 'This mint proof has already been consumed on-chain',
          });
        }

        const sponsorshipReason = Number(
          await paymasterPolicyReader.sponsorshipCheckReason(blankPaymasterUserOp)
        );
        if (sponsorshipReason !== 0) {
          return reply.status(400).send({
            success: false,
            code: 'USEROP_SPONSORSHIP_INVALID',
            error: `PhilPaymaster policy rejected this userOp (reason ${sponsorshipReason})`,
          });
        }

        const validAfter = now;
        const validUntil = now + sponsorshipWindowSec;

        const hash = await paymasterHashReader.getHash(
          blankPaymasterUserOp,
          validUntil,
          validAfter
        );

        const signature = await paymasterSigner.signMessage(ethers.getBytes(hash));
        const locked = db.markIssuedMintProofPaymasterSigned(proofRecord.proofId, now);
        if (!locked) {
          return reply.status(409).send({
            success: false,
            code: 'PROOF_ALREADY_SPONSORED',
            error: 'This proof has already been used for paymaster sponsorship',
          });
        }

        const validUntilHex = ethers.zeroPadValue(ethers.toBeHex(validUntil), 16);
        const validAfterHex = ethers.zeroPadValue(ethers.toBeHex(validAfter), 16);
        const paymasterValidationGasHex = ethers.zeroPadValue(
          ethers.toBeHex(PAYMASTER_VALIDATION_GAS_LIMIT),
          16
        );
        const paymasterPostOpGasHex = ethers.zeroPadValue(
          ethers.toBeHex(PAYMASTER_POST_OP_GAS_LIMIT),
          16
        );
        const paymasterAndData = ethers.concat([
          paymaster,
          paymasterValidationGasHex,
          paymasterPostOpGasHex,
          validUntilHex,
          validAfterHex,
          signature,
        ]);

        fastify.log.info({
          msg: 'Paymaster sponsorship signed',
          sender,
          mintRecipient,
          proofId: proofRecord.proofId,
          validUntil,
          validAfter,
          chainId,
        });

        return {
          success: true,
          paymasterAndData: ethers.hexlify(paymasterAndData),
          validUntil,
          validAfter,
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          code: 'INTERNAL_ERROR',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
