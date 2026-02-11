import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { evmNetworkOptions } from '../../../shared/networkOptions';

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		default: 'getOrCreate',
		options: [
			{
				name: 'Get or Create',
				value: 'getOrCreate',
				description: 'Get an existing EVM account by name, or create one',
				action: 'Get or create an EVM account',
			},
			{
				name: 'List Balances',
				value: 'listBalances',
				description: 'List all token balances for an address',
				action: 'List token balances',
			},
			{
				name: 'Request Faucet',
				value: 'requestFaucet',
				description: 'Request testnet tokens from a faucet',
				action: 'Request testnet faucet tokens',
			},
		],
	},
	{
		displayName: 'Account Name',
		name: 'accountName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['account'], operation: ['getOrCreate'] } },
		description: 'Unique name for the account. Returns existing if name matches.',
	},
	{
		displayName: 'Address',
		name: 'address',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['account'], operation: ['listBalances', 'requestFaucet'] } },
		description: 'The EVM wallet address (0x...)',
	},
	{
		displayName: 'Network',
		name: 'network',
		type: 'options',
		default: 'base-sepolia',
		displayOptions: { show: { resource: ['account'], operation: ['listBalances'] } },
		options: evmNetworkOptions,
	},
	{
		displayName: 'Faucet Network',
		name: 'faucetNetwork',
		type: 'options',
		default: 'base-sepolia',
		displayOptions: { show: { resource: ['account'], operation: ['requestFaucet'] } },
		options: [
			{ name: 'Base Sepolia', value: 'base-sepolia' },
			{ name: 'Ethereum Sepolia', value: 'ethereum-sepolia' },
		],
	},
	{
		displayName: 'Token',
		name: 'faucetToken',
		type: 'options',
		default: 'eth',
		displayOptions: { show: { resource: ['account'], operation: ['requestFaucet'] } },
		options: [
			{ name: 'ETH', value: 'eth' },
			{ name: 'USDC', value: 'usdc' },
		],
	},
];

export async function executeAccountOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	if (operation === 'getOrCreate') {
		const name = context.getNodeParameter('accountName', i) as string;
		const account = await cdp.evm.getOrCreateAccount({ name });
		return { address: account.address, name };
	}

	if (operation === 'listBalances') {
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

	if (operation === 'requestFaucet') {
		const address = context.getNodeParameter('address', i) as string;
		const network = context.getNodeParameter('faucetNetwork', i) as string;
		const token = context.getNodeParameter('faucetToken', i) as string;
		const result = await cdp.evm.requestFaucet({
			address: address as `0x${string}`,
			token: token as 'eth',
			network: network as 'base-sepolia',
		});
		return { transactionHash: result.transactionHash, address, token, network };
	}

	throw new Error(`Unknown account operation: ${operation}`);
}
