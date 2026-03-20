import { ethers } from 'ethers';

export function normalizeAddress(address) {
  return ethers.getAddress(address).toLowerCase();
}

export function leafForAddress(address) {
  return ethers.keccak256(ethers.solidityPacked(['address'], [ethers.getAddress(address)]));
}

export function hashPair(a, b) {
  const left = BigInt(a) <= BigInt(b) ? a : b;
  const right = left === a ? b : a;
  return ethers.keccak256(ethers.solidityPacked(['bytes32', 'bytes32'], [left, right]));
}

export function buildMerkleTree(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('addresses must be a non-empty array');
  }

  const normalized = addresses.map((addr) => normalizeAddress(addr));
  const leaves = normalized.map((addr) => leafForAddress(addr));
  const layers = [leaves];

  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = prev[i + 1] ?? prev[i];
      next.push(hashPair(left, right));
    }
    layers.push(next);
  }

  const root = layers[layers.length - 1][0];

  function getProof(index) {
    if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
      throw new Error(`invalid merkle index ${index}`);
    }
    const proof = [];
    let cursor = index;
    for (let level = 0; level < layers.length - 1; level += 1) {
      const layer = layers[level];
      const siblingIndex = cursor ^ 1;
      const sibling = layer[siblingIndex] ?? layer[cursor];
      proof.push(sibling);
      cursor = Math.floor(cursor / 2);
    }
    return proof;
  }

  return {
    root,
    leaves,
    layers,
    addresses: normalized,
    getProof,
    getProofByAddress(address) {
      const idx = normalized.indexOf(normalizeAddress(address));
      if (idx === -1) {
        throw new Error(`address not in tree: ${address}`);
      }
      return {
        index: idx,
        proof: getProof(idx),
      };
    },
  };
}
