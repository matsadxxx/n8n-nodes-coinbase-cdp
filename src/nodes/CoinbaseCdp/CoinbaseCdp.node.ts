import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { getCdpClient } from '../../shared/cdpClientFactory';
import { accountOperations, executeAccountOperation } from './resources/account';
import { solanaAccountOperations, executeSolanaAccountOperation } from './resources/solanaAccount';
import { smartAccountOperations, executeSmartAccountOperation } from './resources/smartAccount';
import { transferOperations, executeTransferOperation } from './resources/transfer';
import { swapOperations, executeSwapOperation } from './resources/swap';
import { policyOperations, executePolicyOperation } from './resources/policy';
import { balanceOperations, executeBalanceOperation } from './resources/balance';

const resourceExecutors: Record<
	string,
	(ctx: IExecuteFunctions, cdp: Awaited<ReturnType<typeof getCdpClient>>, op: string, i: number) => Promise<unknown>
> = {
	account: executeAccountOperation,
	solanaAccount: executeSolanaAccountOperation,
	smartAccount: executeSmartAccountOperation,
	transfer: executeTransferOperation,
	swap: executeSwapOperation,
	policy: executePolicyOperation,
	balance: executeBalanceOperation,
};

export class CoinbaseCdp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Coinbase CDP',
		name: 'coinbaseCdp',
		icon: 'file:coinbase.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Interact with Coinbase Developer Platform - accounts, transfers, swaps, policies',
		defaults: {
			name: 'Coinbase CDP',
		},
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'coinbaseCdpApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'account',
				options: [
					{ name: 'EVM Account', value: 'account' },
					{ name: 'Solana Account', value: 'solanaAccount' },
					{ name: 'Smart Account', value: 'smartAccount' },
					{ name: 'Transfer', value: 'transfer' },
					{ name: 'Swap', value: 'swap' },
					{ name: 'Policy', value: 'policy' },
					{ name: 'Balance', value: 'balance' },
				],
			},
			...accountOperations,
			...solanaAccountOperations,
			...smartAccountOperations,
			...transferOperations,
			...swapOperations,
			...policyOperations,
			...balanceOperations,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const cdp = await getCdpClient(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				const executor = resourceExecutors[resource];
				if (!executor) {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`);
				}

				const result = await executor(this, cdp, operation, i);
				returnData.push({ json: result as Record<string, string | number | boolean | null> });
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: message } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
