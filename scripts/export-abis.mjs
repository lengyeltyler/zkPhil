import { exportAbis, writeFrontendContractsConfig } from "../src/contracts.mjs";
import { loadDeploymentAddresses } from "../src/sepolia-pipeline.mjs";

const result = exportAbis();
const addresses = loadDeploymentAddresses();

if (addresses?.contracts?.philNft) {
  writeFrontendContractsConfig(addresses);
}

console.log(JSON.stringify(result, null, 2));
