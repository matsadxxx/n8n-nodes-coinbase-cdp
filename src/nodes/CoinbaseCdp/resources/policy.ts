import type { INodeProperties, IExecuteFunctions } from 'n8n-workflow';
import type { CdpClient } from '@coinbase/cdp-sdk';

export const policyOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['policy'] } },
		default: 'list',
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new policy',
				action: 'Create a policy',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a policy by ID',
				action: 'Delete a policy',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a policy by ID',
				action: 'Get a policy',
			},
			{
				name: 'List',
				value: 'list',
				description: 'List all policies',
				action: 'List policies',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a policy by ID',
				action: 'Update a policy',
			},
		],
	},
	{
		displayName: 'Policy ID',
		name: 'policyId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['policy'], operation: ['get', 'update', 'delete'] } },
		description: 'The ID of the policy',
	},
	{
		displayName: 'Policy JSON',
		name: 'policyJson',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: { show: { resource: ['policy'], operation: ['create', 'update'] } },
		description: 'Policy configuration as JSON. See CDP docs for schema.',
	},
];

export async function executePolicyOperation(
	context: IExecuteFunctions,
	cdp: CdpClient,
	operation: string,
	i: number,
) {
	if (operation === 'list') {
		const policies = await cdp.policies.listPolicies();
		return { policies };
	}

	if (operation === 'get') {
		const policyId = context.getNodeParameter('policyId', i) as string;
		const policy = await cdp.policies.getPolicyById({ id: policyId });
		return policy;
	}

	if (operation === 'create') {
		const policyJson = context.getNodeParameter('policyJson', i) as string;
		const parsed = typeof policyJson === 'string' ? JSON.parse(policyJson) : policyJson;
		const policy = await cdp.policies.createPolicy({ policy: parsed });
		return policy;
	}

	if (operation === 'update') {
		const policyId = context.getNodeParameter('policyId', i) as string;
		const policyJson = context.getNodeParameter('policyJson', i) as string;
		const parsed = typeof policyJson === 'string' ? JSON.parse(policyJson) : policyJson;
		const policy = await cdp.policies.updatePolicy({ id: policyId, policy: parsed });
		return policy;
	}

	if (operation === 'delete') {
		const policyId = context.getNodeParameter('policyId', i) as string;
		await cdp.policies.deletePolicy({ id: policyId });
		return { deleted: true, policyId };
	}

	throw new Error(`Unknown policy operation: ${operation}`);
}
