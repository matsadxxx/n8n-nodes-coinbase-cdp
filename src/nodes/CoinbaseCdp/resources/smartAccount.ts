import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';

export const smartAccountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['smartAccount'] } },
		default: 'getOrCreate',
		options: [
			{
				name: 'Get or Create',
				value: 'getOrCreate',
				description: 'Get or create an ERC-4337 smart account with an owner',
				action: 'Get or create a smart account',
			},
		],
	},
	{
		displayName: 'Owner Account Name',
		name: 'ownerAccountName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['smartAccount'], operation: ['getOrCreate'] } },
		description: 'Name of the owner EVM account (will be created if it does not exist)',
	},
	{
		displayName: 'Smart Account Name',
		name: 'smartAccountName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['smartAccount'], operation: ['getOrCreate'] } },
		description: 'Unique name for the smart account',
	},
];

export async function executeSmartAccountOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	if (operation === 'getOrCreate') {
		const ownerName = context.getNodeParameter('ownerAccountName', i) as string;
		const smartName = context.getNodeParameter('smartAccountName', i) as string;
		const owner = await cdp.evm.getOrCreateAccount({ name: ownerName });
		const smartAccount = await cdp.evm.getOrCreateSmartAccount({ owner, name: smartName });
		return {
			address: smartAccount.address,
			ownerAddress: owner.address,
			ownerName,
			smartAccountName: smartName || undefined,
		};
	}

	throw new Error(`Unknown smartAccount operation: ${operation}`);
}
