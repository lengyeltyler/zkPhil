require('dotenv').config();

const networks = {
  hardhat: {
    chainId: 31337,
    blockGasLimit: 120000000
  },
  localhost: {
    url: "http://127.0.0.1:8545"
  }
};

const sepoliaUrl = String(process.env.RPC_URL_SEPOLIA || '').trim();
const privateKey = String(process.env.PRIVATE_KEY || '').trim();
const hasValidPrivateKey = /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey);
if (sepoliaUrl) {
  networks.sepolia = {
    url: sepoliaUrl,
    accounts: hasValidPrivateKey ? [privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`] : []
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts"
  },
  networks
};
