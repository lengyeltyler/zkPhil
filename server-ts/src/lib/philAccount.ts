import { ethers } from 'ethers';

const FACTORY_ABI = [
  'function getPhilAddress(address owner, uint256 starkPubKeyX) view returns (address)',
];

export type SmartAccountResolver = (recipient: string) => Promise<string>;

export function frontendTestStarkPubKeyX(chainId: number, owner: string): string {
  const normalizedOwner = ethers.getAddress(owner);
  const hashed = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'address'],
    ['phil-test-mode-stark-pubkey', BigInt(chainId), normalizedOwner]
  );
  return ethers.toBeHex(BigInt(hashed), 32);
}

export function createSmartAccountResolver(config: {
  provider: ethers.Provider;
  factoryAddress: string;
  chainId: number;
}): SmartAccountResolver {
  const factoryAddress = ethers.getAddress(config.factoryAddress);
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, config.provider);

  return async (recipient: string) => {
    const owner = ethers.getAddress(recipient);
    const starkPubKeyX = frontendTestStarkPubKeyX(config.chainId, owner);
    const smartAccount = await factory.getPhilAddress(owner, starkPubKeyX);
    return ethers.getAddress(String(smartAccount));
  };
}
