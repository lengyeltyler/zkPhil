require('dotenv').config();

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
  networks: {
    hardhat: {
      chainId: 31337,
      blockGasLimit: 120000000
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};
