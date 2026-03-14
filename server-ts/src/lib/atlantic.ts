/**
 * Atlantic API Integration Module
 *
 * Handles submission of Cairo programs to Atlantic for STARK proof generation.
 * Uses the Atlantic Query API (POST /atlantic-query) with multipart form upload.
 *
 * API Reference: https://docs.herodotus.cloud/atlantic/endpoints/submit-query
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface AtlanticConfig {
  apiUrl: string;
  apiKey: string;
  /** Path to compiled Cairo program (sierra.json or executable.json) */
  programFilePath: string;
  /** Job size: XS, S, M, or L */
  declaredJobSize?: string;
  /** Verification target */
  result?: string;
  /** Atlantic network (e.g. TESTNET) */
  network?: string;
  /** Input encoding for Cairo JSON */
  inputFormat?: InputFormat;
  /** Dump input JSON to disk for debugging */
  dumpInputPath?: string;
  /** Polling timeout in ms (0 or negative disables timeout) */
  timeoutMs?: number;
  /** Poll interval in ms */
  pollIntervalMs?: number;
}

export interface ProofRequest {
  programHash: string;
  inputs: {
    secret: string;
    siblings: string[];
    pathIndices: number[];
    root: string;
    dropId: string;
    recipient: string;
  };
}

export interface ProofResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  factHash?: string;
  outputs?: string[];
  error?: string;
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  factHash?: string;
  outputs?: string[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

function normalizeOutputs(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v));
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractProofData(query: any): { factHash?: string; outputs?: string[] } {
  const factHash =
    query?.factHash ??
    query?.fact_hash ??
    query?.result?.factHash ??
    query?.result?.fact_hash ??
    query?.proof?.factHash ??
    query?.proof?.fact_hash;

  const outputs = normalizeOutputs(
    query?.outputs ??
    query?.publicOutputs ??
    query?.public_outputs ??
    query?.result?.outputs ??
    query?.result?.publicOutputs ??
    query?.result?.public_outputs ??
    query?.proof?.outputs
  );

  return { factHash, outputs };
}

/**
 * Serialize Cairo program inputs to JSON.
 *
 * For fn main(secret: felt252, siblings: Array<felt252>, path_indices: Array<u8>,
 *             root: felt252, drop_id: felt252, recipient: felt252)
 */
function serializeInputsJson(inputs: ProofRequest['inputs']): string {
  const payload = {
    secret: inputs.secret,
    siblings: inputs.siblings,
    path_indices: inputs.pathIndices,
    root: inputs.root,
    drop_id: inputs.dropId,
    recipient: inputs.recipient,
  };
  return JSON.stringify(payload);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function redactHex(hex: string): string {
  if (hex.length <= 10) return hex;
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

function hexToDec(hex: string): string {
  try {
    return BigInt(hex).toString(10);
  } catch {
    return hex;
  }
}

type InputFormat = 'json-hex' | 'json-dec' | 'flat-hex' | 'flat-dec' | 'array-hex' | 'array-dec';

function normalizeInputs(inputs: ProofRequest['inputs'], format: InputFormat): ProofRequest['inputs'] {
  if (format === 'json-hex' || format === 'flat-hex' || format === 'array-hex') {
    return inputs;
  }

  return {
    secret: hexToDec(inputs.secret),
    siblings: inputs.siblings.map(hexToDec),
    pathIndices: inputs.pathIndices,
    root: hexToDec(inputs.root),
    dropId: hexToDec(inputs.dropId),
    recipient: hexToDec(inputs.recipient),
  };
}

function serializeInputsFlat(inputs: ProofRequest['inputs']): string {
  const values: string[] = [];

  // secret: felt252
  values.push(inputs.secret);

  // siblings: Array<felt252> — length-prefixed
  values.push(inputs.siblings.length.toString());
  for (const s of inputs.siblings) {
    values.push(s);
  }

  // path_indices: Array<u8> — length-prefixed
  values.push(inputs.pathIndices.length.toString());
  for (const p of inputs.pathIndices) {
    values.push(p.toString());
  }

  // root: felt252
  values.push(inputs.root);

  // drop_id: felt252
  values.push(inputs.dropId);

  // recipient: felt252
  values.push(inputs.recipient);

  // One value per line
  return values.join('\n');
}

function serializeInputsArray(inputs: ProofRequest['inputs']): string {
  const values: string[] = [];

  // secret: felt252
  values.push(inputs.secret);

  // siblings: Array<felt252> — length-prefixed
  values.push(inputs.siblings.length.toString());
  for (const s of inputs.siblings) {
    values.push(s);
  }

  // path_indices: Array<u8> — length-prefixed
  values.push(inputs.pathIndices.length.toString());
  for (const p of inputs.pathIndices) {
    values.push(p.toString());
  }

  // root: felt252
  values.push(inputs.root);

  // drop_id: felt252
  values.push(inputs.dropId);

  // recipient: felt252
  values.push(inputs.recipient);

  return `[${values.join(' ')}]`;
}

/**
 * Atlantic API Client
 *
 * Submits Cairo programs + inputs to Atlantic for STARK proof generation.
 * Polls for completion and returns the proof status.
 */
export class AtlanticClient {
  private config: AtlanticConfig;

  constructor(config: AtlanticConfig) {
    this.config = config;
  }

  /**
   * Submit a proof request to Atlantic.
   *
   * POST /atlantic-query?apiKey=...
   * Content-Type: multipart/form-data
   */
  async submitProof(request: ProofRequest): Promise<ProofResponse> {
    // Read the compiled Cairo program file
    const programFilePath = path.resolve(this.config.programFilePath);
    if (!fs.existsSync(programFilePath)) {
      throw new Error(`Program file not found: ${programFilePath}`);
    }
    const programFileBuffer = fs.readFileSync(programFilePath);
    const programFileName = path.basename(programFilePath);

    const inputFormat = this.config.inputFormat || 'json-hex';
    const normalizedInputs = normalizeInputs(request.inputs, inputFormat);
    const inputText =
      inputFormat.startsWith('flat-') ? serializeInputsFlat(normalizedInputs)
      : inputFormat.startsWith('array-') ? serializeInputsArray(normalizedInputs)
      : serializeInputsJson(normalizedInputs);
    const inputHash = hashText(inputText);
    const inputPreview = {
      secret: redactHex(request.inputs.secret),
      siblingsCount: request.inputs.siblings.length,
      pathIndicesCount: request.inputs.pathIndices.length,
      root: redactHex(request.inputs.root),
      dropId: redactHex(request.inputs.dropId),
      recipient: redactHex(request.inputs.recipient),
      inputFormat,
    };

    if (this.config.dumpInputPath) {
      try {
        fs.writeFileSync(this.config.dumpInputPath, inputText);
      } catch (err) {
        console.log('[Atlantic] Failed to dump input file', {
          path: this.config.dumpInputPath,
          error: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    // Build multipart form
    const form = new FormData();

    // Program file
    form.append(
      'programFile',
      new Blob([programFileBuffer], { type: 'application/json' }),
      programFileName
    );

    // Input file (Cairo 1 JSON format)
    const isTextInput = inputFormat.startsWith('flat-') || inputFormat.startsWith('array-');
    form.append(
      'inputFile',
      new Blob([inputText], { type: isTextInput ? 'text/plain' : 'application/json' }),
      isTextInput ? 'input.txt' : 'input.json'
    );

    // Required parameters
    form.append('declaredJobSize', this.config.declaredJobSize || 'S');
    form.append('cairoVersion', 'cairo1');
    form.append('cairoVm', 'rust');
    form.append('layout', 'auto');
    form.append('result', this.config.result || 'PROOF_VERIFICATION_ON_L1');
    form.append('mockFactHash', 'false');
    form.append('network', this.config.network || 'TESTNET');

    // Submit to Atlantic
    const url = `${this.config.apiUrl}/atlantic-query?apiKey=${encodeURIComponent(this.config.apiKey)}`;

    console.log('[Atlantic] Submitting proof', {
      apiUrl: this.config.apiUrl,
      programFileName,
      programFileBytes: programFileBuffer.byteLength,
      declaredJobSize: this.config.declaredJobSize || 'S',
      cairoVersion: 'cairo1',
      cairoVm: 'rust',
      layout: 'auto',
      result: this.config.result || 'PROOF_VERIFICATION_ON_L1',
      network: this.config.network || 'TESTNET',
      inputHash,
      inputPreview,
    });

    const response = await fetch(url, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Atlantic API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { atlanticQueryId: string };

    return {
      jobId: data.atlanticQueryId,
      status: 'pending',
    };
  }

  /**
   * Check the status of an Atlantic query.
   *
   * GET /atlantic-query/{atlanticQueryId}
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const url = `${this.config.apiUrl}/atlantic-query/${jobId}`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Atlantic API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      atlanticQuery: {
        id: string;
        status: string;
        step?: string;
        errorReason?: string;
        createdAt: string;
        completedAt?: string;
        factHash?: string;
        fact_hash?: string;
        outputs?: unknown;
        publicOutputs?: unknown;
        public_outputs?: unknown;
        result?: {
          factHash?: string;
          fact_hash?: string;
          outputs?: unknown;
          publicOutputs?: unknown;
          public_outputs?: unknown;
        };
      };
    };

    const query = data.atlanticQuery;
    const { factHash, outputs } = extractProofData(query);
    // Emit raw Atlantic status details to help diagnose failures.
    console.log('[Atlantic] Raw query status', {
      id: query.id,
      status: query.status,
      step: query.step,
      errorReason: query.errorReason,
      createdAt: query.createdAt,
      completedAt: query.completedAt,
    });

    // Map Atlantic status to our status enum
    let status: JobStatus['status'];
    switch (query.status) {
      case 'DONE':
        status = 'completed';
        break;
      case 'FAILED':
        status = 'failed';
        break;
      case 'IN_PROGRESS':
        status = 'processing';
        break;
      case 'RECEIVED':
      default:
        status = 'pending';
        break;
    }

    return {
      jobId: query.id,
      status,
      error: query.errorReason,
      createdAt: query.createdAt,
      completedAt: query.completedAt,
      factHash,
      outputs,
    };
  }

  /**
   * Wait for a proof job to complete by polling.
   * Atlantic proof generation can take several minutes.
   */
  async waitForCompletion(
    jobId: string,
    timeoutMs: number = this.config.timeoutMs ?? 600000, // 10 minutes (proofs can take a while)
    pollIntervalMs: number = this.config.pollIntervalMs ?? 10000 // 10 seconds
  ): Promise<JobStatus> {
    const startTime = Date.now();

    console.log(`[Atlantic] Waiting for query ${jobId} to complete...`);

    const hasTimeout = timeoutMs > 0;

    while (!hasTimeout || Date.now() - startTime < timeoutMs) {
      const status = await this.getJobStatus(jobId);

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[Atlantic] Query ${jobId}: ${status.status} (${elapsed}s elapsed)`);

      if (status.status === 'completed') {
        console.log(`[Atlantic] Query ${jobId} completed successfully`);
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Proof generation failed: ${status.error || 'unknown error'}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Proof generation timed out after ${timeoutMs / 1000}s`);
  }
}

/**
 * Mock Atlantic Client for local testing
 *
 * Simulates Atlantic API responses without actually generating STARK proofs.
 */
export class MockAtlanticClient {
  private jobs: Map<string, JobStatus> = new Map();
  private jobCounter = 0;

  /**
   * Submit a mock proof request
   */
  async submitProof(request: ProofRequest): Promise<ProofResponse> {
    const jobId = `mock-job-${++this.jobCounter}`;

    // Immediately mark as completed with mock data
    this.jobs.set(jobId, {
      jobId,
      status: 'completed',
      factHash: '0x' + '0'.repeat(64), // Mock factHash
      outputs: [
        request.inputs.root,
        request.inputs.dropId,
        request.inputs.recipient,
        '0x' + 'abcd'.repeat(16), // Mock nullifier
        '0x' + '1234'.repeat(16), // Mock leaf
        '4', // Mock idx (tree depth)
      ],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    return {
      jobId,
      status: 'completed',
    };
  }

  /**
   * Get mock job status
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const status = this.jobs.get(jobId);
    if (!status) {
      throw new Error(`Job ${jobId} not found`);
    }
    return status;
  }

  /**
   * Wait for mock completion (returns immediately)
   */
  async waitForCompletion(jobId: string): Promise<JobStatus> {
    return this.getJobStatus(jobId);
  }
}
