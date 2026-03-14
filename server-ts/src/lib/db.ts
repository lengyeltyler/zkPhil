import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface AuthChallengeRecord {
  nonce: string;
  recipient: string;
  message: string;
  issued_at: number;
  expires_at: number;
  consumed_at: number | null;
}

export interface AuthSessionRecord {
  token: string;
  recipient: string;
  issued_at: number;
  expires_at: number;
}

interface IssuedMintProofRow {
  proof_id: string;
  recipient: string;
  mint_to: string;
  phil_id: number;
  palette_variant: number;
  mix_mode: number;
  mix_seed: number;
  expiry: string;
  claim_hash: string;
  fact_hash: string;
  signature: string;
  issued_at: number;
  expires_at: number;
  paymaster_signed_at: number | null;
  used_at: number | null;
}

export interface IssuedMintProofRecord {
  proofId: string;
  recipient: string;
  mintTo: string;
  philId: number;
  paletteVariant: number;
  mixMode: number;
  mixSeed: number;
  expiry: string;
  claimHash: string;
  factHash: string;
  signature: string;
  issuedAt: number;
  expiresAt: number;
  paymasterSignedAt: number | null;
  usedAt: number | null;
}

export class PhilDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.ensureAuthTables();
    this.ensureIssuedMintProofTable();
    this.ensureAllowlistEntitlementsTable();
  }

  private ensureAuthTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_challenges (
        nonce TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        message TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_auth_challenges_recipient ON auth_challenges(recipient);
      CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_recipient ON auth_sessions(recipient);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
    `);
  }

  private ensureIssuedMintProofTable() {
    const table = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'issued_mint_proofs'`
      )
      .get() as { name?: string } | undefined;

    if (!table?.name) {
      this.createIssuedMintProofTable();
      return;
    }

    const columns = this.db
      .prepare(`PRAGMA table_info(issued_mint_proofs)`)
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));

    const expectedColumns = [
      'proof_id',
      'recipient',
      'mint_to',
      'phil_id',
      'palette_variant',
      'mix_mode',
      'mix_seed',
      'expiry',
      'claim_hash',
      'fact_hash',
      'signature',
      'issued_at',
      'expires_at',
      'paymaster_signed_at',
      'used_at',
    ];
    if (expectedColumns.every((column) => names.has(column)) && names.size === expectedColumns.length) {
      this.createIssuedMintProofIndexes();
      return;
    }

    const legacyTable = `issued_mint_proofs_legacy_${Date.now()}`;
    this.db.exec(`ALTER TABLE issued_mint_proofs RENAME TO ${legacyTable};`);
    this.createIssuedMintProofTable();

    const migrateStmt = this.db.prepare(`
      INSERT INTO issued_mint_proofs (
        proof_id,
        recipient,
        mint_to,
        phil_id,
        palette_variant,
        mix_mode,
        mix_seed,
        expiry,
        claim_hash,
        fact_hash,
        signature,
        issued_at,
        expires_at,
        paymaster_signed_at,
        used_at
      )
      SELECT
        proof_id,
        recipient,
        mint_to,
        phil_id,
        palette_variant,
        mix_mode,
        mix_seed,
        expiry,
        claim_hash,
        fact_hash,
        signature,
        issued_at,
        expires_at,
        paymaster_signed_at,
        used_at
      FROM ${legacyTable}
    `);

    migrateStmt.run();
  }

  private createIssuedMintProofTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS issued_mint_proofs (
        proof_id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        mint_to TEXT NOT NULL,
        phil_id INTEGER NOT NULL,
        palette_variant INTEGER NOT NULL,
        mix_mode INTEGER NOT NULL,
        mix_seed INTEGER NOT NULL,
        expiry TEXT NOT NULL,
        claim_hash TEXT NOT NULL,
        fact_hash TEXT NOT NULL,
        signature TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        paymaster_signed_at INTEGER,
        used_at INTEGER
      );
    `);

    this.createIssuedMintProofIndexes();
  }

  private createIssuedMintProofIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_issued_mint_proofs_recipient ON issued_mint_proofs(recipient);
      CREATE INDEX IF NOT EXISTS idx_issued_mint_proofs_expires ON issued_mint_proofs(expires_at);
    `);
  }

  private ensureAllowlistEntitlementsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS allowlist_entitlements (
        drop_id TEXT NOT NULL,
        address TEXT NOT NULL,
        remaining INTEGER NOT NULL CHECK (remaining >= 0),
        PRIMARY KEY (drop_id, address)
      );

      CREATE INDEX IF NOT EXISTS idx_allowlist_entitlements_address
        ON allowlist_entitlements(address);
    `);
  }

  private mapIssuedMintProof(row: IssuedMintProofRow): IssuedMintProofRecord {
    return {
      proofId: row.proof_id,
      recipient: row.recipient,
      mintTo: row.mint_to,
      philId: row.phil_id,
      paletteVariant: row.palette_variant,
      mixMode: row.mix_mode,
      mixSeed: row.mix_seed,
      expiry: row.expiry,
      claimHash: row.claim_hash,
      factHash: row.fact_hash,
      signature: row.signature,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      paymasterSignedAt: row.paymaster_signed_at,
      usedAt: row.used_at,
    };
  }

  createAuthChallenge(record: Omit<AuthChallengeRecord, 'consumed_at'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_challenges (nonce, recipient, message, issued_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `);
    stmt.run(
      record.nonce,
      record.recipient.toLowerCase(),
      record.message,
      record.issued_at,
      record.expires_at
    );
  }

  consumeAuthChallenge(recipient: string, nonce: string, now: number): AuthChallengeRecord | null {
    const tx = this.db.transaction(() => {
      this.deleteExpiredAuthChallenges(now);
      const stmt = this.db.prepare(`
        SELECT * FROM auth_challenges
        WHERE nonce = ? AND recipient = ? AND consumed_at IS NULL
        LIMIT 1
      `);
      const row = stmt.get(nonce, recipient.toLowerCase()) as AuthChallengeRecord | undefined;
      if (!row) {
        return null;
      }

      const updateStmt = this.db.prepare(`
        UPDATE auth_challenges
        SET consumed_at = ?
        WHERE nonce = ? AND consumed_at IS NULL
      `);
      const result = updateStmt.run(now, nonce);
      if (result.changes !== 1) {
        return null;
      }

      return {
        ...row,
        consumed_at: now,
      };
    });

    return tx();
  }

  createAuthSession(record: AuthSessionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO auth_sessions (token, recipient, issued_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(
      record.token,
      record.recipient.toLowerCase(),
      record.issued_at,
      record.expires_at
    );
  }

  getAuthSession(token: string, now: number): AuthSessionRecord | null {
    this.deleteExpiredAuthSessions(now);
    const stmt = this.db.prepare(`
      SELECT * FROM auth_sessions
      WHERE token = ?
      LIMIT 1
    `);
    const row = stmt.get(token) as AuthSessionRecord | undefined;
    return row ?? null;
  }

  private deleteExpiredAuthChallenges(now: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM auth_challenges
      WHERE expires_at < ? OR consumed_at IS NOT NULL
    `);
    stmt.run(now);
  }

  private deleteExpiredAuthSessions(now: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM auth_sessions
      WHERE expires_at < ?
    `);
    stmt.run(now);
  }

  createIssuedMintProof(record: IssuedMintProofRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO issued_mint_proofs (
        proof_id,
        recipient,
        mint_to,
        phil_id,
        palette_variant,
        mix_mode,
        mix_seed,
        expiry,
        claim_hash,
        fact_hash,
        signature,
        issued_at,
        expires_at,
        paymaster_signed_at,
        used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.proofId,
      record.recipient.toLowerCase(),
      record.mintTo.toLowerCase(),
      record.philId,
      record.paletteVariant,
      record.mixMode,
      record.mixSeed,
      record.expiry.toLowerCase(),
      record.claimHash.toLowerCase(),
      record.factHash.toLowerCase(),
      record.signature.toLowerCase(),
      record.issuedAt,
      record.expiresAt,
      record.paymasterSignedAt,
      record.usedAt
    );
  }

  consumeAllowlistEntitlementAndCreateIssuedMintProof(
    dropId: string,
    address: string,
    record: IssuedMintProofRecord
  ): number | null {
    const tx = this.db.transaction(() => {
      const normalizedAddress = address.toLowerCase();
      const updateStmt = this.db.prepare(`
        UPDATE allowlist_entitlements
        SET remaining = remaining - 1
        WHERE drop_id = ? AND address = ? AND remaining > 0
      `);
      const result = updateStmt.run(dropId, normalizedAddress);
      if (result.changes !== 1) {
        return null;
      }

      this.createIssuedMintProof(record);

      const row = this.db.prepare(`
        SELECT remaining
        FROM allowlist_entitlements
        WHERE drop_id = ? AND address = ?
        LIMIT 1
      `).get(dropId, normalizedAddress) as { remaining: number } | undefined;

      return row?.remaining ?? 0;
    });

    return tx();
  }

  getIssuedMintProof(proofId: string, now: number): IssuedMintProofRecord | null {
    const tx = this.db.transaction(() => {
      this.deleteExpiredIssuedMintProofs(now);
      const stmt = this.db.prepare(`
        SELECT * FROM issued_mint_proofs
        WHERE proof_id = ?
        LIMIT 1
      `);
      const row = stmt.get(proofId) as IssuedMintProofRow | undefined;
      if (!row) {
        return null;
      }
      return this.mapIssuedMintProof(row);
    });

    return tx();
  }

  markIssuedMintProofPaymasterSigned(proofId: string, now: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE issued_mint_proofs
      SET paymaster_signed_at = ?
      WHERE proof_id = ? AND paymaster_signed_at IS NULL
    `);
    const result = stmt.run(now, proofId);
    return result.changes === 1;
  }

  markIssuedMintProofUsed(proofId: string, now: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE issued_mint_proofs
      SET used_at = ?
      WHERE proof_id = ? AND used_at IS NULL
    `);
    const result = stmt.run(now, proofId);
    return result.changes === 1;
  }

  ensureAllowlistEntitlement(dropId: string, address: string, initialRemaining: number): void {
    if (!Number.isInteger(initialRemaining) || initialRemaining < 0) {
      throw new Error(`Invalid allowlist entitlement: ${initialRemaining}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO allowlist_entitlements (drop_id, address, remaining)
      VALUES (?, ?, ?)
      ON CONFLICT(drop_id, address) DO NOTHING
    `);
    stmt.run(dropId, address.toLowerCase(), initialRemaining);
  }

  getAllowlistRemaining(dropId: string, address: string): number {
    const stmt = this.db.prepare(`
      SELECT remaining
      FROM allowlist_entitlements
      WHERE drop_id = ? AND address = ?
      LIMIT 1
    `);
    const row = stmt.get(dropId, address.toLowerCase()) as { remaining: number } | undefined;
    return row?.remaining ?? 0;
  }

  consumeAllowlistEntitlement(dropId: string, address: string): number | null {
    const tx = this.db.transaction(() => {
      const normalizedAddress = address.toLowerCase();
      const updateStmt = this.db.prepare(`
        UPDATE allowlist_entitlements
        SET remaining = remaining - 1
        WHERE drop_id = ? AND address = ? AND remaining > 0
      `);
      const result = updateStmt.run(dropId, normalizedAddress);
      if (result.changes !== 1) {
        return null;
      }

      const row = this.db.prepare(`
        SELECT remaining
        FROM allowlist_entitlements
        WHERE drop_id = ? AND address = ?
        LIMIT 1
      `).get(dropId, normalizedAddress) as { remaining: number } | undefined;

      return row?.remaining ?? 0;
    });

    return tx();
  }

  private deleteExpiredIssuedMintProofs(now: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM issued_mint_proofs
      WHERE expires_at < ?
    `);
    stmt.run(now);
  }

  close(): void {
    this.db.close();
  }
}
