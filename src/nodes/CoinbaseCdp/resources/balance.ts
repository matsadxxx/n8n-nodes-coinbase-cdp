import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { evmNetworkOptions } from '../../../shared/networkOptions';

export const balanceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['balance'] } },
		default: 'listTokens',
		options: [
			{
				name: 'List Token Balances',
				value: 'listTokens',
				description: 'List all token balances for an EVM address',
				action: 'List token balances',
			},
		],
	},
	{
		displayName: 'Address',
		name: 'address',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['balance'] } },
		description: 'The EVM wallet address (0x...)',
	},
	{
		displayName: 'Network',
		name: 'network',
		type: 'options',
		default: 'base-sepolia',
		displayOptions: { show: { resource: ['balance'] } },
		options: evmNetworkOptions,
	},
];

export async function executeBalanceOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	if (operation === 'listTokens') {
		const address = context.getNodeParameter('address', i) as string;
		const network = context.getNodeParameter('network', i) as string;
		const result = await cdp.evm.listTokenBalances({
			address: address as `0x${string}`,
			network: network as 'base-sepolia',
		});
		return {
			address,
			network,
			balances: result.balances.map((b) => ({
				token: b.token.symbol || b.token.contractAddress,
				amount: b.amount,
			})),
		};
	}

	throw new Error(`Unknown balance operation: ${operation}`);
}
