function normalizeComparableAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  return raw.toLowerCase();
}

export function evaluateBackendCompatibility({
  backendStatus,
  expectedChainId,
  expectedFactory = '',
  expectedProofGate = '',
  expectedPaymaster = '',
}) {
  const reasons = [];
  const backendChainId = Number(backendStatus?.backendChainId);

  if (!Number.isFinite(backendChainId) || backendChainId !== Number(expectedChainId)) {
    reasons.push(
      `backendChainId=${Number.isFinite(backendChainId) ? backendChainId : 'unknown'} expected=${expectedChainId}`
    );
  }

  const comparablePairs = [
    ['backendFactory', backendStatus?.backendFactory, expectedFactory],
    ['proofGateAddress', backendStatus?.proofGateAddress, expectedProofGate],
    ['paymasterAddress', backendStatus?.paymasterAddress, expectedPaymaster],
  ];

  for (const [label, actual, expected] of comparablePairs) {
    const normalizedExpected = normalizeComparableAddress(expected);
    const normalizedActual = normalizeComparableAddress(actual);
    if (!normalizedExpected || !normalizedActual) {
      continue;
    }
    if (normalizedExpected !== normalizedActual) {
      reasons.push(`${label}=${actual} expected=${expected}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function buildBackendCompatibilityMessage(details) {
  if (!details.reasons?.length) {
    return 'Backend and frontend are aligned.';
  }

  return `Backend and frontend are not aligned: ${details.reasons.join('; ')}`;
}
