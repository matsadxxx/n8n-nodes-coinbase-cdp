import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { parseEther } from '@coinbase/cdp-sdk';
import { evmNetworkOptions } from '../../../shared/networkOptions';

export const transferOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['transfer'] } },
		default: 'sendNative',
		options: [
			{
				name: 'Send Native Token',
				value: 'sendNative',
				description: 'Transfer native cryptocurrency (ETH, etc.)',
				action: 'Send native token',
			},
			{
				name: 'Send ERC-20 Token',
				value: 'sendErc20',
				description: 'Transfer an ERC-20 token (USDC, DAI, etc.)',
				action: 'Send ERC-20 token',
			},
		],
	},
	{
		displayName: 'Sender Account Name',
		name: 'accountName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['transfer'] } },
		description: 'Name of the sending account',
	},
	{
		displayName: 'Recipient Address',
		name: 'to',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['transfer'] } },
		description: 'Destination wallet address (0x...)',
	},
	{
		displayName: 'Amount',
		name: 'amount',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['transfer'] } },
		description: 'Amount to send in human-readable units (e.g. "0.01")',
	},
	{
		displayName: 'Token',
		name: 'token',
		type: 'string',
		default: 'usdc',
		required: true,
		displayOptions: { show: { resource: ['transfer'], operation: ['sendErc20'] } },
		description: 'Token symbol (e.g. "usdc") or contract address (0x...)',
	},
	{
		displayName: 'Network',
		name: 'network',
		type: 'options',
		default: 'base-sepolia',
		displayOptions: { show: { resource: ['transfer'] } },
		options: evmNetworkOptions,
	},
];

export async function executeTransferOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	const accountName = context.getNodeParameter('accountName', i) as string;
	const to = context.getNodeParameter('to', i) as string;
	const amount = context.getNodeParameter('amount', i) as string;
	const network = context.getNodeParameter('network', i) as string;

	const account = await cdp.evm.getOrCreateAccount({ name: accountName });

	if (operation === 'sendNative') {
		const result = await account.transfer({
			to: to as `0x${string}`,
			amount: parseEther(amount),
			token: 'eth',
			network: network as 'base-sepolia',
		});
		return {
			transactionHash: result.transactionHash,
			from: account.address,
			to,
			amount,
			token: 'eth',
			network,
		};
	}

	if (operation === 'sendErc20') {
		const token = context.getNodeParameter('token', i) as string;
		const result = await account.transfer({
			to: to as `0x${string}`,
			amount: amount as unknown as bigint,
			token: token as 'usdc',
			network: network as 'base-sepolia',
		});
		return {
			transactionHash: result.transactionHash,
			from: account.address,
			to,
			amount,
			token,
			network,
		};
	}

	throw new Error(`Unknown transfer operation: ${operation}`);
}
