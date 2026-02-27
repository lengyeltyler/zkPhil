# Local Node Configuration

This project is pinned to a local Ethereum RPC endpoint:

- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`

## Expected usage

The default workflow is an SSH tunnel to your self-hosted node:

```bash
ssh -L 8545:127.0.0.1:8545 <user>@<your-node-host>
```

After the tunnel is up, verify connectivity:

```bash
curl -sS http://127.0.0.1:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

## No hosted RPC

The local flow intentionally does not use Infura, Alchemy, or hosted proof services.
