import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { swapNetworkOptions } from '../../../shared/networkOptions';

export const swapOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['swap'] } },
		default: 'execute',
		options: [
			{
				name: 'Execute Swap',
				value: 'execute',
				description: 'Swap one token for another',
				action: 'Execute a token swap',
			},
			{
				name: 'Get Quote',
				value: 'quote',
				description: 'Get a swap quote without executing',
				action: 'Get swap quote',
			},
		],
	},
	{
		displayName: 'Account Name',
		name: 'accountName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['swap'] } },
		description: 'Name of the account performing the swap',
	},
	{
		displayName: 'From Token',
		name: 'fromToken',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['swap'] } },
		description: 'Token to swap from - symbol (e.g. "eth") or contract address (0x...)',
	},
	{
		displayName: 'To Token',
		name: 'toToken',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['swap'] } },
		description: 'Token to swap to - symbol (e.g. "usdc") or contract address (0x...)',
	},
	{
		displayName: 'Amount',
		name: 'fromAmount',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['swap'] } },
		description: 'Amount of source token in human-readable units',
	},
	{
		displayName: 'Network',
		name: 'network',
		type: 'options',
		default: 'base-sepolia',
		displayOptions: { show: { resource: ['swap'] } },
		options: swapNetworkOptions,
	},
];

export async function executeSwapOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	const accountName = context.getNodeParameter('accountName', i) as string;
	const fromToken = context.getNodeParameter('fromToken', i) as string;
	const toToken = context.getNodeParameter('toToken', i) as string;
	const fromAmount = context.getNodeParameter('fromAmount', i) as string;
	const network = context.getNodeParameter('network', i) as string;

	const account = await cdp.evm.getOrCreateAccount({ name: accountName });

	if (operation === 'execute') {
		const result = await account.swap({
			fromToken: fromToken as `0x${string}`,
			toToken: toToken as `0x${string}`,
			fromAmount: fromAmount as unknown as bigint,
			network: network as 'base',
		});
		return {
			transactionHash: result.transactionHash,
			from: account.address,
			fromToken,
			toToken,
			fromAmount,
			network,
		};
	}

	if (operation === 'quote') {
		const quote = await account.quoteSwap({
			fromToken: fromToken as `0x${string}`,
			toToken: toToken as `0x${string}`,
			fromAmount: fromAmount as unknown as bigint,
			network: network as 'base',
		});
		if (!quote.liquidityAvailable) {
			return {
				liquidityAvailable: false,
				fromToken,
				toToken,
				fromAmount,
				network,
			};
		}
		return {
			liquidityAvailable: true,
			toAmount: quote.toAmount,
			fromToken,
			toToken,
			fromAmount,
			network,
		};
	}

	throw new Error(`Unknown swap operation: ${operation}`);
}
