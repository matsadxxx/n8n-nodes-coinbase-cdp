import type {
	IPollFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { getCdpClient } from '../../shared/cdpClientFactory';
import { evmNetworkOptions } from '../../shared/networkOptions';

export class CoinbaseTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Coinbase CDP Trigger',
		name: 'coinbaseTrigger',
		icon: 'file:coinbase.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Triggers workflow on Coinbase CDP balance changes',
		defaults: {
			name: 'Coinbase CDP Trigger',
		},
		polling: true,
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'coinbaseCdpApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				default: 'balanceChanged',
				options: [
					{
						name: 'Balance Changed',
						value: 'balanceChanged',
						description: 'Trigger when any token balance changes for the address',
					},
				],
			},
			{
				displayName: 'Address',
				name: 'address',
				type: 'string',
				default: '',
				required: true,
				description: 'The EVM wallet address to monitor (0x...)',
			},
			{
				displayName: 'Network',
				name: 'network',
				type: 'options',
				default: 'base-sepolia',
				options: evmNetworkOptions,
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const address = this.getNodeParameter('address') as string;
		const network = this.getNodeParameter('network') as string;
		const cdp = await getCdpClient(this);

		const result = await cdp.evm.listTokenBalances({
			address: address as `0x${string}`,
			network: network as 'base-sepolia',
		});

		const currentBalances: Record<string, string> = {};
		for (const b of result.balances) {
			const key = b.token.symbol || b.token.contractAddress || 'unknown';
			currentBalances[key] = String(b.amount);
		}

		const lastBalances = (this.getWorkflowStaticData('node') as Record<string, unknown>)
			.lastBalances as Record<string, string> | undefined;

		// Store current state for next poll
		(this.getWorkflowStaticData('node') as Record<string, unknown>).lastBalances =
			currentBalances;

		// First run - store baseline, don't trigger
		if (!lastBalances) {
			return null;
		}

		// Compare balances
		const changes: Array<{ token: string; previousBalance: string; currentBalance: string }> = [];

		const allTokens = new Set([...Object.keys(lastBalances), ...Object.keys(currentBalances)]);
		for (const token of allTokens) {
			const prev = lastBalances[token] || '0';
			const curr = currentBalances[token] || '0';
			if (prev !== curr) {
				changes.push({ token, previousBalance: prev, currentBalance: curr });
			}
		}

		if (changes.length === 0) {
			return null;
		}

		return [
			changes.map((change) => ({
				json: {
					address,
					network,
					...change,
					timestamp: new Date().toISOString(),
				},
			})),
		];
	}
}
