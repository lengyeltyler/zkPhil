import http from 'node:http';

import { generateLocalProofArtifact } from './prove_local.mjs';

const PORT = Number(process.env.LOCAL_PROVER_PORT || '8747');
const HOST = process.env.LOCAL_PROVER_HOST || '127.0.0.1';
const MANIFEST_PATH = process.env.LOCAL_PROVER_MANIFEST || 'cairo/Scarb.toml';
const ENABLE_PROVE = String(process.env.LOCAL_PROVER_ENABLE_PROVE || 'true').toLowerCase() !== 'false';
const ENABLE_VERIFY = String(process.env.LOCAL_PROVER_ENABLE_VERIFY || 'false').toLowerCase() === 'true';

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, provingMode: 'scarb-stwo' });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/prove') {
    sendJson(res, 404, { success: false, error: 'Not found' });
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('error', (error) => sendJson(res, 500, { success: false, error: error.message }));
  req.on('end', async () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const request = payload?.request || payload?.provingRequest || payload;
      const artifact = await generateLocalProofArtifact({
        request,
        manifestPath: MANIFEST_PATH,
        prove: ENABLE_PROVE,
        verify: ENABLE_VERIFY,
      });
      sendJson(res, 200, {
        success: true,
        artifact,
        proof: artifact.contractProof,
      });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`zkPhil local prover listening at http://${HOST}:${PORT}\n`);
});
