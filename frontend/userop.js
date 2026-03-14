/**
 * UserOperation Builder & Bundler Interface for Phil EIP-4337
 *
 * Handles:
 * - Building PackedUserOperations for mint calls
 * - Gas estimation via bundler RPC
 * - UserOp submission to bundler
 * - Receipt polling
 *
 * Designed for ERC-4337 v0.7.0 (EntryPoint 0x0000000071727De22E5E9d8BAf0edAc6f37da032)
 */

// ── Constants ──

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// SmartAccount.execute(address target, uint256 value, bytes calldata data)
const EXECUTE_SELECTOR = "0xb61d27f6";

const MINT_FRAGMENT =
  "function mint(address recipient, address mintTo, uint8 philId, uint8 paletteVariant, uint8 mixMode, uint32 mixSeed, (uint256 expiry, bytes32 factHash, bytes signature) proof)";
const CREATE_ACCOUNT_FRAGMENT =
  "function createPhilAccount(address owner, uint256 starkPubKeyX, (uint256 expiry, bytes32 factHash, bytes signature) proof)";

// Default gas values (overridden by estimation)
const DEFAULT_VERIFICATION_GAS = 500000n;
const DEFAULT_CALL_GAS = 300000n;
const DEFAULT_PRE_VERIFICATION_GAS = 100000n;

// ── ABI Encoding Helpers ──

/**
 * Encode PhilTestMint.mint() calldata
 */
export function normalizeMintProofForAbi(ethers, proof) {
  if (!proof) {
    throw new Error("MintProof is required");
  }
  return {
    expiry: BigInt(proof.expiry ?? 0),
    factHash: ethers.zeroPadValue(proof.factHash, 32),
    signature: proof.signature ?? "0x",
  };
}

export function encodeMintCalldata(ethers, {
  recipient,
  mintTo,
  philId,
  paletteVariant,
  mixMode = 0,
  mixSeed = 0,
  proof,
}) {
  const iface = new ethers.Interface([MINT_FRAGMENT]);
  return iface.encodeFunctionData("mint", [
    recipient,
    mintTo,
    philId,
    paletteVariant,
    mixMode,
    mixSeed,
    normalizeMintProofForAbi(ethers, proof),
  ]);
}

/**
 * Encode SmartAccount.execute() calldata wrapping an inner call
 */
export function encodeExecuteCalldata(ethers, target, value, innerData) {
  const iface = new ethers.Interface([
    "function execute(address target, uint256 value, bytes data)",
  ]);
  return iface.encodeFunctionData("execute", [target, value, innerData]);
}

/**
 * Encode the factory initCode for first-time account deployment
 * initCode = factoryAddress + createPhilAccount(owner, starkPubKeyX, proof)
 */
export function encodeInitCode(ethers, factoryAddress, owner, starkPubKeyX, proof) {
  const iface = new ethers.Interface([CREATE_ACCOUNT_FRAGMENT]);
  if (!proof) {
    throw new Error("createProof is required when building initCode");
  }
  const factoryData = iface.encodeFunctionData("createPhilAccount", [
    owner,
    starkPubKeyX,
    normalizeMintProofForAbi(ethers, proof),
  ]);
  // initCode = factory address (20 bytes) + factory calldata
  return ethers.concat([factoryAddress, factoryData]);
}

// ── Pack Gas Fields (v0.7.0 format) ──

/**
 * Pack verificationGasLimit and callGasLimit into bytes32
 * [16 bytes verificationGas][16 bytes callGas]
 */
export function packAccountGasLimits(verificationGas, callGas) {
  const vg = BigInt(verificationGas);
  const cg = BigInt(callGas);
  return "0x" + vg.toString(16).padStart(32, "0") + cg.toString(16).padStart(32, "0");
}

/**
 * Pack maxPriorityFeePerGas and maxFeePerGas into bytes32
 * [16 bytes maxPriorityFee][16 bytes maxFeePerGas]
 */
export function packGasFees(maxPriorityFee, maxFeePerGas) {
  const pf = BigInt(maxPriorityFee);
  const mf = BigInt(maxFeePerGas);
  return "0x" + pf.toString(16).padStart(32, "0") + mf.toString(16).padStart(32, "0");
}

// ── UserOp Builder ──

/**
 * Build a UserOperation for minting a Phil NFT
 *
 * @param {object} params
 * @param {object} params.ethers - ethers.js library
 * @param {string} params.smartAccount - Smart Account address
 * @param {string} params.factoryAddress - PhilAccountFactory address
 * @param {boolean} params.isDeployed - Whether the Smart Account is already deployed
 * @param {string} params.eoa - EOA owner address
 * @param {string} params.starkPubKeyX - STARK public key X-coordinate
 * @param {string} params.philTestMint - PhilTestMint contract address
 * @param {object} params.createProof - MintProof for first-time account deployment
 * @param {object} params.mintParams - Mint parameters
 * @param {string} params.paymasterAndData - Paymaster data (or "0x" for self-pay)
 * @param {object} params.provider - ethers provider for gas estimation
 * @returns {object} PackedUserOperation (unsigned)
 */
export async function buildMintUserOp({
  ethers,
  smartAccount,
  factoryAddress,
  isDeployed,
  eoa,
  starkPubKeyX,
  philTestMint,
  createProof,
  mintParams,
  paymasterAndData = "0x",
  provider,
  entryPointAddress = ENTRY_POINT_V07,
}) {
  if (!isDeployed) {
    const factory = new ethers.Contract(
      factoryAddress,
      ["function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)"],
      provider
    );
    const expectedSender = await factory.getPhilAddress(eoa, starkPubKeyX);
    if (expectedSender.toLowerCase() !== smartAccount.toLowerCase()) {
      throw new Error(
        `Sender/initCode mismatch: expected ${expectedSender} from factory, got ${smartAccount}`
      );
    }
  }

  // ── Encode mint calldata ──
  const mintCalldata = encodeMintCalldata(ethers, {
    ...mintParams,
    mintTo: smartAccount, // Mint TO the smart account
  });

  // ── Encode execute wrapper ──
  const callData = encodeExecuteCalldata(ethers, philTestMint, 0, mintCalldata);

  // ── InitCode (only if account not yet deployed) ──
  const initCode = isDeployed
    ? "0x"
    : encodeInitCode(ethers, factoryAddress, eoa, starkPubKeyX, createProof);

  // ── Get nonce from EntryPoint ──
  let nonce = "0x0";
  try {
    const ep = new ethers.Contract(entryPointAddress, [
      "function getNonce(address sender, uint192 key) view returns (uint256)",
    ], provider);
    nonce = ethers.toBeHex(await ep.getNonce(smartAccount, 0));
  } catch {
    // If EntryPoint not available (local test), use 0
    nonce = "0x0";
  }

  // ── Gas estimation ──
  let verificationGas = DEFAULT_VERIFICATION_GAS;
  let callGas = DEFAULT_CALL_GAS;
  let preVerificationGas = DEFAULT_PRE_VERIFICATION_GAS;

  // If account needs deployment, increase verification gas
  if (!isDeployed) {
    verificationGas = 1300000n;
  }

  // ── Fee data ──
  let maxFeePerGas = 30000000000n; // 30 gwei default
  let maxPriorityFee = 2000000000n; // 2 gwei default
  try {
    const feeData = await provider.getFeeData();
    if (feeData.maxFeePerGas) maxFeePerGas = feeData.maxFeePerGas;
    if (feeData.maxPriorityFeePerGas) maxPriorityFee = feeData.maxPriorityFeePerGas;
  } catch {
    // Use defaults
  }

  const userOp = {
    sender: smartAccount,
    nonce,
    initCode,
    callData,
    accountGasLimits: packAccountGasLimits(verificationGas, callGas),
    preVerificationGas: ethers.toBeHex(preVerificationGas),
    gasFees: packGasFees(maxPriorityFee, maxFeePerGas),
    paymasterAndData,
    signature: "0x" + "00".repeat(65), // Placeholder (65 bytes EOA)
  };

  return userOp;
}

// ── UserOp Hash ──

/**
 * Compute the userOpHash that needs to be signed
 * This matches EntryPoint.getUserOpHash()
 */
export function getUserOpHash(ethers, userOp, chainId, entryPointAddress = ENTRY_POINT_V07) {
  // Pack the UserOp (without signature)
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "address",   // sender
      "uint256",   // nonce
      "bytes32",   // keccak256(initCode)
      "bytes32",   // keccak256(callData)
      "bytes32",   // accountGasLimits
      "uint256",   // preVerificationGas
      "bytes32",   // gasFees
      "bytes32",   // keccak256(paymasterAndData)
    ],
    [
      userOp.sender,
      userOp.nonce,
      ethers.keccak256(userOp.initCode || "0x"),
      ethers.keccak256(userOp.callData),
      userOp.accountGasLimits,
      userOp.preVerificationGas,
      userOp.gasFees,
      ethers.keccak256(userOp.paymasterAndData || "0x"),
    ]
  );

  const userOpPacked = ethers.keccak256(packed);

  // Final hash includes EntryPoint address and chain ID
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256"],
      [userOpPacked, entryPointAddress, chainId]
    )
  );
}

// ── Signature Assembly ──

/**
 * Sign the UserOp with EOA
 *
 * @param {object} params
 * @param {object} params.ethers - ethers.js library
 * @param {object} params.userOp - The unsigned UserOperation
 * @param {string} params.userOpHash - The UserOp hash
 * @param {object} params.eoaSigner - ethers.Signer for the EOA
 * @returns {string} 65-byte signature hex
 */
export async function signUserOp({
  ethers,
  userOpHash,
  eoaSigner,
}) {
  return await eoaSigner.signMessage(ethers.getBytes(userOpHash));
}

// ── Bundler Interface ──

/**
 * Send a UserOperation via the bundler
 *
 * @param {string} bundlerRpc - Bundler RPC URL
 * @param {object} userOp - Signed UserOperation
 * @returns {string} UserOp hash from bundler
 */
export async function sendUserOp(bundlerRpc, userOp) {
  const response = await fetch(bundlerRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendUserOperation",
      params: [userOp, ENTRY_POINT_V07],
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Bundler error: ${result.error.message || JSON.stringify(result.error)}`);
  }
  return result.result; // UserOp hash
}

/**
 * Wait for a UserOperation receipt
 *
 * @param {string} bundlerRpc - Bundler RPC URL
 * @param {string} userOpHash - UserOp hash from sendUserOp
 * @param {number} timeoutMs - Max wait time (default: 60000)
 * @param {number} pollIntervalMs - Poll interval (default: 2000)
 * @returns {object} UserOp receipt
 */
export async function waitForUserOpReceipt(
  bundlerRpc,
  userOpHash,
  timeoutMs = 60000,
  pollIntervalMs = 2000
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(bundlerRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getUserOperationReceipt",
        params: [userOpHash],
      }),
    });

    const result = await response.json();
    if (result.result) {
      return result.result;
    }

    // Wait before next poll
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("UserOp receipt timeout");
}

/**
 * Estimate gas for a UserOperation via bundler
 *
 * @param {string} bundlerRpc - Bundler RPC URL
 * @param {object} userOp - UserOperation (can have dummy signature)
 * @returns {object} Gas estimates { preVerificationGas, verificationGasLimit, callGasLimit }
 */
export async function estimateUserOpGas(bundlerRpc, userOp) {
  const response = await fetch(bundlerRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_estimateUserOperationGas",
      params: [userOp, ENTRY_POINT_V07],
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`Gas estimation error: ${result.error.message || JSON.stringify(result.error)}`);
  }
  return result.result;
}

export { ENTRY_POINT_V07 };
