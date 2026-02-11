import { createMockCdpClient } from './helpers';
import type { CdpClient } from '@coinbase/cdp-sdk';

jest.mock('../src/shared/cdpClientFactory', () => ({
	getCdpClient: jest.fn(),
}));

import { getCdpClient } from '../src/shared/cdpClientFactory';
import { CoinbaseCdp } from '../src/nodes/CoinbaseCdp/CoinbaseCdp.node';
import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

const mockedGetCdpClient = getCdpClient as jest.MockedFunction<typeof getCdpClient>;

describe('CoinbaseCdp Node', () => {
	let node: CoinbaseCdp;
	let mockCdp: ReturnType<typeof createMockCdpClient>;

	beforeEach(() => {
		node = new CoinbaseCdp();
		mockCdp = createMockCdpClient();
		mockedGetCdpClient.mockResolvedValue(mockCdp as unknown as CdpClient);
	});

	function createExecuteContext(params: Record<string, unknown>, inputItems = [{ json: {} }]) {
		return {
			getInputData: jest.fn().mockReturnValue(inputItems),
			getNodeParameter: jest.fn((name: string, _i: number, fallback?: unknown) => {
				return params[name] ?? fallback;
			}),
			getCredentials: jest.fn().mockResolvedValue({
				apiKeyId: 'test', apiKeySecret: 'test', walletSecret: 'test',
			}),
			getNode: jest.fn().mockReturnValue({ name: 'Coinbase CDP' }),
			continueOnFail: jest.fn().mockReturnValue(false),
		} as unknown as IExecuteFunctions;
	}

	describe('description', () => {
		it('has correct node metadata', () => {
			expect(node.description.displayName).toBe('Coinbase CDP');
			expect(node.description.name).toBe('coinbaseCdp');
			expect(node.description.usableAsTool).toBe(true);
			expect(node.description.version).toBe(1);
		});

		it('has credential requirement', () => {
			expect(node.description.credentials).toEqual([
				{ name: 'coinbaseCdpApi', required: true },
			]);
		});

		it('has all 7 resources', () => {
			const resourceProp = node.description.properties.find(p => p.name === 'resource');
			expect(resourceProp).toBeDefined();
			const options = (resourceProp as { options: Array<{ value: string }> }).options;
			expect(options).toHaveLength(7);
			const values = options.map(o => o.value);
			expect(values).toContain('account');
			expect(values).toContain('solanaAccount');
			expect(values).toContain('smartAccount');
			expect(values).toContain('transfer');
			expect(values).toContain('swap');
			expect(values).toContain('policy');
			expect(values).toContain('balance');
		});
	});

	describe('execute', () => {
		it('executes account getOrCreate', async () => {
			const ctx = createExecuteContext({ resource: 'account', operation: 'getOrCreate', accountName: 'Test' });
			const result = await node.execute.call(ctx);
			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);
			expect(result[0][0].json).toMatchObject({
				address: '0x1234567890abcdef1234567890abcdef12345678',
				name: 'Test',
			});
		});

		it('executes balance listTokens', async () => {
			const ctx = createExecuteContext({ resource: 'balance', operation: 'listTokens', address: '0xtest', network: 'base' });
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toHaveProperty('balances');
		});

		it('executes transfer sendNative', async () => {
			const ctx = createExecuteContext({
				resource: 'transfer', operation: 'sendNative',
				accountName: 'Sender', to: '0xrecip', amount: '0.01', network: 'base-sepolia',
			});
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toMatchObject({ transactionHash: '0xmocktxhash123' });
		});

		it('executes swap execute', async () => {
			const ctx = createExecuteContext({
				resource: 'swap', operation: 'execute',
				accountName: 'Trader', fromToken: 'eth', toToken: 'usdc', fromAmount: '1', network: 'base',
			});
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toMatchObject({ transactionHash: '0xmockswaphash123' });
		});

		it('executes policy list', async () => {
			const ctx = createExecuteContext({ resource: 'policy', operation: 'list' });
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toHaveProperty('policies');
		});

		it('executes solanaAccount getOrCreate', async () => {
			const ctx = createExecuteContext({ resource: 'solanaAccount', operation: 'getOrCreate', accountName: 'SolWallet' });
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toMatchObject({
				address: 'SoLaNaAdDrEsS1234567890abcdef',
				name: 'SolWallet',
			});
		});

		it('executes smartAccount getOrCreate', async () => {
			const ctx = createExecuteContext({
				resource: 'smartAccount', operation: 'getOrCreate',
				ownerAccountName: 'Owner', smartAccountName: 'Smart',
			});
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toMatchObject({
				address: '0xsmartaccount1234567890abcdef1234567890ab',
			});
		});

		it('processes multiple input items', async () => {
			const items = [{ json: {} }, { json: {} }];
			const ctx = createExecuteContext({ resource: 'account', operation: 'getOrCreate', accountName: 'Test' }, items);
			const result = await node.execute.call(ctx);
			expect(result[0]).toHaveLength(2);
		});

		it('throws NodeOperationError on unknown resource', async () => {
			const ctx = createExecuteContext({ resource: 'unknown', operation: 'test' });
			await expect(node.execute.call(ctx)).rejects.toThrow('Unknown resource: unknown');
		});

		it('continues on fail when enabled', async () => {
			const ctx = createExecuteContext({ resource: 'unknown', operation: 'test' });
			(ctx.continueOnFail as jest.Mock).mockReturnValue(true);
			const result = await node.execute.call(ctx);
			expect(result[0][0].json).toHaveProperty('error');
			expect((result[0][0].json as { error: string }).error).toContain('Unknown resource: unknown');
		});

		it('continues on fail with SDK errors', async () => {
			mockCdp.evm.getOrCreateAccount.mockRejectedValueOnce(new Error('Network error'));
			const ctx = createExecuteContext({ resource: 'account', operation: 'getOrCreate', accountName: 'Test' });
			(ctx.continueOnFail as jest.Mock).mockReturnValue(true);
			const result = await node.execute.call(ctx);
			expect((result[0][0].json as { error: string }).error).toBe('Network error');
		});

		it('continues on fail with non-Error thrown values', async () => {
			mockCdp.evm.getOrCreateAccount.mockRejectedValueOnce('string error');
			const ctx = createExecuteContext({ resource: 'account', operation: 'getOrCreate', accountName: 'Test' });
			(ctx.continueOnFail as jest.Mock).mockReturnValue(true);
			const result = await node.execute.call(ctx);
			expect((result[0][0].json as { error: string }).error).toBe('string error');
		});

		it('throws error when continueOnFail is false', async () => {
			mockCdp.evm.getOrCreateAccount.mockRejectedValueOnce(new Error('API down'));
			const ctx = createExecuteContext({ resource: 'account', operation: 'getOrCreate', accountName: 'Test' });
			await expect(node.execute.call(ctx)).rejects.toThrow('API down');
		});
	});
});
