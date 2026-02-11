import type { INodePropertyOptions } from 'n8n-workflow';

export const evmNetworkOptions: INodePropertyOptions[] = [
	{ name: 'Base', value: 'base' },
	{ name: 'Base Sepolia (Testnet)', value: 'base-sepolia' },
	{ name: 'Ethereum', value: 'ethereum' },
	{ name: 'Ethereum Sepolia (Testnet)', value: 'ethereum-sepolia' },
	{ name: 'Arbitrum', value: 'arbitrum' },
	{ name: 'Optimism', value: 'optimism' },
	{ name: 'Polygon', value: 'polygon' },
	{ name: 'BNB Chain', value: 'bnb' },
	{ name: 'Avalanche', value: 'avalanche' },
	{ name: 'Zora', value: 'zora' },
];

export const solanaNetworkOptions: INodePropertyOptions[] = [
	{ name: 'Solana Mainnet', value: 'solana-mainnet' },
	{ name: 'Solana Devnet (Testnet)', value: 'solana-devnet' },
];

export const swapNetworkOptions: INodePropertyOptions[] = [
	{ name: 'Base', value: 'base' },
	{ name: 'Base Sepolia (Testnet)', value: 'base-sepolia' },
	{ name: 'Ethereum', value: 'ethereum' },
	{ name: 'Ethereum Sepolia (Testnet)', value: 'ethereum-sepolia' },
];

export const faucetNetworkOptions: INodePropertyOptions[] = [
	{ name: 'Base Sepolia', value: 'base-sepolia' },
	{ name: 'Ethereum Sepolia', value: 'ethereum-sepolia' },
	{ name: 'Solana Devnet', value: 'solana-devnet' },
];

export const faucetTokenOptions: INodePropertyOptions[] = [
	{ name: 'ETH', value: 'eth' },
	{ name: 'USDC', value: 'usdc' },
	{ name: 'SOL', value: 'sol' },
];
