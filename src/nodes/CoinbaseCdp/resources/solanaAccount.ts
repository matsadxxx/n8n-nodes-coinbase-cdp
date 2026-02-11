import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';

export const solanaAccountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['solanaAccount'] } },
		default: 'getOrCreate',
		options: [
			{
				name: 'Get or Create',
				value: 'getOrCreate',
				description: 'Get an existing Solana account by name, or create one',
				action: 'Get or create a Solana account',
			},
			{
				name: 'Request Faucet',
				value: 'requestFaucet',
				description: 'Request Solana devnet tokens from faucet',
				action: 'Request Solana devnet tokens',
			},
		],
	},
	{
		displayName: 'Account Name',
		name: 'accountName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['solanaAccount'], operation: ['getOrCreate'] } },
		description: 'Unique name for the Solana account',
	},
	{
		displayName: 'Address',
		name: 'address',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['solanaAccount'], operation: ['requestFaucet'] } },
		description: 'The Solana wallet address',
	},
	{
		displayName: 'Token',
		name: 'faucetToken',
		type: 'options',
		default: 'sol',
		displayOptions: { show: { resource: ['solanaAccount'], operation: ['requestFaucet'] } },
		options: [
			{ name: 'SOL', value: 'sol' },
			{ name: 'USDC', value: 'usdc' },
		],
	},
];

export async function executeSolanaAccountOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	if (operation === 'getOrCreate') {
		const name = context.getNodeParameter('accountName', i) as string;
		const account = await cdp.solana.getOrCreateAccount({ name });
		return { address: account.address, name };
	}

	if (operation === 'requestFaucet') {
		const address = context.getNodeParameter('address', i) as string;
		const token = context.getNodeParameter('faucetToken', i) as string;
		const result = await cdp.solana.requestFaucet({
			address,
			token: token as 'sol',
		});
		return { signature: result.signature, address, token, network: 'solana-devnet' };
	}

	throw new Error(`Unknown solanaAccount operation: ${operation}`);
}
