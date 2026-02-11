import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { getCdpClient } from '../../shared/cdpClientFactory';
import { walletDetailsTool } from './actions/walletDetails';
import { nativeTransferTool } from './actions/nativeTransfer';
import { erc20TransferTool } from './actions/erc20Transfer';
import { erc20BalanceTool } from './actions/erc20Balance';
import { swapTool } from './actions/swap';
import { getSwapPriceTool } from './actions/getSwapPrice';
import { requestFaucetTool } from './actions/requestFaucet';

const toolBuilders = {
	walletDetails: walletDetailsTool,
	nativeTransfer: nativeTransferTool,
	erc20Transfer: erc20TransferTool,
	erc20Balance: erc20BalanceTool,
	swap: swapTool,
	getSwapPrice: getSwapPriceTool,
	requestFaucet: requestFaucetTool,
} as const;

export class CoinbaseAgentTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Coinbase CDP Tool',
		name: 'coinbaseAgentTool',
		icon: 'file:coinbase.svg',
		group: ['transform'],
		version: 1,
		description: 'Use Coinbase CDP as a tool for AI agents - wallets, transfers, swaps, and more',
		defaults: {
			name: 'Coinbase CDP Tool',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.cdp.coinbase.com/',
					},
				],
			},
		},
		inputs: [],
		outputs: ['ai_tool'],
		outputNames: ['Tool'],
		credentials: [
			{
				name: 'coinbaseCdpApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Tool',
				name: 'tool',
				type: 'options',
				noDataExpression: true,
				default: 'walletDetails',
				options: [
					{
						name: 'Get Wallet Details',
						value: 'walletDetails',
						description: 'Get or create an EVM account and return its address',
					},
					{
						name: 'Native Transfer',
						value: 'nativeTransfer',
						description: 'Transfer native cryptocurrency (ETH, etc.) to an address',
					},
					{
						name: 'ERC-20 Transfer',
						value: 'erc20Transfer',
						description: 'Transfer an ERC-20 token (USDC, DAI, etc.) to an address',
					},
					{
						name: 'Get Balance',
						value: 'erc20Balance',
						description: 'Check the balance of any token for a wallet address',
					},
					{
						name: 'Swap Tokens',
						value: 'swap',
						description: 'Swap one token for another on Base or Ethereum',
					},
					{
						name: 'Get Swap Price',
						value: 'getSwapPrice',
						description: 'Get a price quote for a token swap without executing',
					},
					{
						name: 'Request Faucet',
						value: 'requestFaucet',
						description: 'Request testnet tokens from a faucet',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, _itemIndex: number): Promise<SupplyData> {
		const toolName = this.getNodeParameter('tool', 0) as keyof typeof toolBuilders;
		const cdp = await getCdpClient(this);
		const builder = toolBuilders[toolName];
		const tool = builder(cdp);
		return { response: tool };
	}
}
