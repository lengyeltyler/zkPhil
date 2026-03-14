import { ethers } from "ethers";

export const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA_HEX_CHAIN_ID = "0xaa36a7";

export async function loadContractsConfig() {
  const response = await fetch("/contracts.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load the frontend contract config.");
  }

  return response.json();
}

export function createContracts(config, providerOrSigner) {
  return {
    svgStorage: new ethers.Contract(
      config.contracts.svgStorage.address,
      config.contracts.svgStorage.abi,
      providerOrSigner
    ),
    layerRegistry: new ethers.Contract(
      config.contracts.layerRegistry.address,
      config.contracts.layerRegistry.abi,
      providerOrSigner
    ),
    philNft: new ethers.Contract(
      config.contracts.philNft.address,
      config.contracts.philNft.abi,
      providerOrSigner
    )
  };
}

export function hasDeployment(config) {
  return Boolean(
    config?.contracts?.svgStorage?.address &&
      config?.contracts?.layerRegistry?.address &&
      config?.contracts?.philNft?.address
  );
}

export async function switchToSepolia(rawProvider) {
  if (!rawProvider?.request) {
    return;
  }

  try {
    await rawProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_HEX_CHAIN_ID }]
    });
  } catch (error) {
    if (error?.code === 4902) {
      await rawProvider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_HEX_CHAIN_ID,
            chainName: "Sepolia",
            nativeCurrency: {
              name: "Sepolia Ether",
              symbol: "SEP",
              decimals: 18
            },
            rpcUrls: [import.meta.env.VITE_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"]
          }
        ]
      });
      return;
    }

    throw error;
  }
}

export function shortenAddress(address) {
  if (!address) {
    return "Not connected";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function decodeTokenUri(tokenUri) {
  const payload = tokenUri.split(",")[1] || "";
  const jsonText = atob(payload);
  return JSON.parse(jsonText);
}

export async function connectInjectedWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask or another injected wallet was not found.");
  }

  await switchToSepolia(window.ethereum);
  const browserProvider = new ethers.BrowserProvider(window.ethereum);
  await browserProvider.send("eth_requestAccounts", []);
  const signer = await browserProvider.getSigner();
  const address = await signer.getAddress();
  const network = await browserProvider.getNetwork();

  if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
    throw new Error("Please connect your wallet to Sepolia.");
  }

  return {
    connector: "MetaMask",
    address,
    signer,
    provider: browserProvider,
    rawProvider: window.ethereum
  };
}

export async function connectWalletConnect() {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    throw new Error("Set VITE_WALLETCONNECT_PROJECT_ID to enable WalletConnect.");
  }

  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const wcProvider = await EthereumProvider.init({
    projectId,
    chains: [SEPOLIA_CHAIN_ID],
    showQrModal: true,
    optionalChains: [SEPOLIA_CHAIN_ID]
  });

  await wcProvider.connect();
  const browserProvider = new ethers.BrowserProvider(wcProvider);
  const signer = await browserProvider.getSigner();
  const address = await signer.getAddress();
  const network = await browserProvider.getNetwork();

  if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
    throw new Error("WalletConnect connected to the wrong chain. Please use Sepolia.");
  }

  return {
    connector: "WalletConnect",
    address,
    signer,
    provider: browserProvider,
    rawProvider: wcProvider
  };
}

export function createReadOnlyProvider() {
  const rpcUrl = import.meta.env.VITE_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    return null;
  }

  return new ethers.JsonRpcProvider(rpcUrl);
}
