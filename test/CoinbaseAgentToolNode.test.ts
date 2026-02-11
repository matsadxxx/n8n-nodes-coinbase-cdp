import { createMockCdpClient } from './helpers';
import type { CdpClient } from '@coinbase/cdp-sdk';

jest.mock('../src/shared/cdpClientFactory', () => ({
	getCdpClient: jest.fn(),
}));

import { getCdpClient } from '../src/shared/cdpClientFactory';
import { CoinbaseAgentTool } from '../src/nodes/CoinbaseAgentTool/CoinbaseAgentTool.node';
import type { ISupplyDataFunctions } from 'n8n-workflow';

const mockedGetCdpClient = getCdpClient as jest.MockedFunction<typeof getCdpClient>;

describe('CoinbaseAgentTool Node', () => {
	let node: CoinbaseAgentTool;
	let mockCdp: ReturnType<typeof createMockCdpClient>;

	beforeEach(() => {
		node = new CoinbaseAgentTool();
		mockCdp = createMockCdpClient();
		mockedGetCdpClient.mockResolvedValue(mockCdp as unknown as CdpClient);
	});

	function createSupplyContext(toolName: string) {
		return {
			getNodeParameter: jest.fn((name: string) => {
				if (name === 'tool') return toolName;
				return '';
			}),
			getCredentials: jest.fn().mockResolvedValue({
				apiKeyId: 'test', apiKeySecret: 'test', walletSecret: 'test',
			}),
		} as unknown as ISupplyDataFunctions;
	}

	describe('description', () => {
		it('has correct node metadata', () => {
			expect(node.description.displayName).toBe('Coinbase CDP Tool');
			expect(node.description.name).toBe('coinbaseAgentTool');
			expect(node.description.outputs).toEqual(['ai_tool']);
			expect(node.description.outputNames).toEqual(['Tool']);
		});

		it('has AI codex categories', () => {
			expect(node.description.codex?.categories).toEqual(['AI']);
			expect(node.description.codex?.subcategories?.AI).toEqual(['Tools']);
		});

		it('has all 7 tools', () => {
			const toolProp = node.description.properties.find(p => p.name === 'tool');
			expect(toolProp).toBeDefined();
			const options = (toolProp as { options: Array<{ value: string }> }).options;
			expect(options).toHaveLength(7);
			const values = options.map(o => o.value);
			expect(values).toContain('walletDetails');
			expect(values).toContain('nativeTransfer');
			expect(values).toContain('erc20Transfer');
			expect(values).toContain('erc20Balance');
			expect(values).toContain('swap');
			expect(values).toContain('getSwapPrice');
			expect(values).toContain('requestFaucet');
		});
	});

	describe('supplyData', () => {
		it('returns walletDetails tool', async () => {
			const ctx = createSupplyContext('walletDetails');
			const result = await node.supplyData.call(ctx, 0);
			expect(result.response).toBeDefined();
			expect((result.response as { name: string }).name).toBe('get_wallet_details');
		});

		it('returns nativeTransfer tool', async () => {
			const ctx = createSupplyContext('nativeTransfer');
			const result = await node.supplyData.call(ctx, 0);
			expect((result.response as { name: string }).name).toBe('native_transfer');
		});

		it('returns erc20Transfer tool', async () => {
			const ctx = createSupplyContext('erc20Transfer');
			const result = await node.supplyData.call(ctx, 0);
			expect((result.response as { name: string }).name).toBe('erc20_transfer');
		});

		it('returns erc20Balance tool', async () => {
			const ctx = createSupplyContext('erc20Balance');
			const result = await node.supplyData.call(ctx, 0);
			expect((result.response as { name: string }).name).toBe('get_balance');
		});

		it('returns swap tool', async () => {
			const ctx = createSupplyContext('swap');
			const result = await node.supplyData.call(ctx, 0);
			expect((result.response as { name: string }).name).toBe('swap_tokens');
		});

		it('returns getSwapPrice tool', async () => {
			const ctx = createSupplyContext('getSwapPrice');
			const result = await node.supplyData.call(ctx, 0);
			expect((result.response as { name: string }).name).toBe('get_swap_price');
		});

		it('returns requestFaucet tool', async () => {
			const ctx = createSupplyContext('requestFaucet');
			const result = await node.supplyData.call(ctx, 0);
			expect((result.response as { name: string }).name).toBe('request_faucet');
		});

		it('tool is invocable (walletDetails)', async () => {
			const ctx = createSupplyContext('walletDetails');
			const { response: tool } = await node.supplyData.call(ctx, 0);
			const result = await (tool as { invoke: (input: Record<string, string>) => Promise<string> }).invoke({ name: 'TestWallet' });
			const parsed = JSON.parse(result);
			expect(parsed.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
		});

		it('tool is invocable (erc20Balance)', async () => {
			const ctx = createSupplyContext('erc20Balance');
			const { response: tool } = await node.supplyData.call(ctx, 0);
			const result = await (tool as { invoke: (input: Record<string, string>) => Promise<string> }).invoke({ address: '0xtest', token: 'ETH', network: 'base-sepolia' });
			const parsed = JSON.parse(result);
			expect(parsed.amount).toBe('1000000000000000000');
		});
	});
});
