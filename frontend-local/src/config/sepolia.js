const injectedConfig =
  typeof __SEPOLIA_PREVIEW_CONFIG__ !== 'undefined'
    ? __SEPOLIA_PREVIEW_CONFIG__
    : null;

export const SEPOLIA_PREVIEW_CONFIG = {
  chainId: 11155111,
  philIdentityMintAddress: injectedConfig?.philIdentityMintAddress || '',
  rendererAddress: injectedConfig?.rendererAddress || '',
  web3Address: injectedConfig?.web3Address || '',
  layerRegistryAddress: injectedConfig?.layerRegistryAddress || '',
  svgStorageAddress: injectedConfig?.svgStorageAddress || '',
};
