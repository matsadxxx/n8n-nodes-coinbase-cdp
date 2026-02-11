import { createMockCdpClient } from './helpers';

jest.mock('../src/shared/cdpClientFactory', () => ({
	getCdpClient: jest.fn(),
}));

import { getCdpClient } from '../src/shared/cdpClientFactory';
import { CoinbaseTrigger } from '../src/nodes/CoinbaseTrigger/CoinbaseTrigger.node';
import type { CdpClient } from '@coinbase/cdp-sdk';

const mockedGetCdpClient = getCdpClient as jest.MockedFunction<typeof getCdpClient>;

describe('CoinbaseTrigger', () => {
	let trigger: CoinbaseTrigger;
	let mockCdp: ReturnType<typeof createMockCdpClient>;
	let staticData: Record<string, unknown>;

	beforeEach(() => {
		trigger = new CoinbaseTrigger();
		mockCdp = createMockCdpClient();
		staticData = {};
		mockedGetCdpClient.mockResolvedValue(mockCdp as unknown as CdpClient);
	});

	function createPollContext(params: Record<string, string> = {}) {
		const defaults: Record<string, string> = {
			address: '0xTestAddress',
			network: 'base-sepolia',
			event: 'balanceChanged',
			...params,
		};
		return {
			getNodeParameter: jest.fn((name: string) => defaults[name]),
			getCredentials: jest.fn().mockResolvedValue({
				apiKeyId: 'test', apiKeySecret: 'test', walletSecret: 'test',
			}),
			getWorkflowStaticData: jest.fn().mockReturnValue(staticData),
		};
	}

	describe('description', () => {
		it('has correct node metadata', () => {
			expect(trigger.description.displayName).toBe('Coinbase CDP Trigger');
			expect(trigger.description.name).toBe('coinbaseTrigger');
			expect(trigger.description.polling).toBe(true);
			expect(trigger.description.group).toEqual(['trigger']);
		});

		it('has credential requirement', () => {
			expect(trigger.description.credentials).toEqual([
				{ name: 'coinbaseCdpApi', required: true },
			]);
		});

		it('has address, network, and event properties', () => {
			const names = trigger.description.properties.map(p => p.name);
			expect(names).toContain('event');
			expect(names).toContain('address');
			expect(names).toContain('network');
		});
	});

	describe('poll', () => {
		it('returns null on first poll (baseline capture)', async () => {
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).toBeNull();
			expect(staticData.lastBalances).toBeDefined();
		});

		it('stores current balances on first poll', async () => {
			const ctx = createPollContext();
			await trigger.poll.call(ctx as never);

			expect(staticData.lastBalances).toEqual({
				ETH: '1000000000000000000',
				USDC: '50000000',
			});
		});

		it('returns null when balances unchanged', async () => {
			staticData.lastBalances = { ETH: '1000000000000000000', USDC: '50000000' };
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).toBeNull();
		});

		it('detects balance change and returns change data', async () => {
			staticData.lastBalances = { ETH: '500000000000000000', USDC: '50000000' };
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).not.toBeNull();
			expect(result![0]).toHaveLength(1);
			expect(result![0][0].json).toMatchObject({
				token: 'ETH',
				previousBalance: '500000000000000000',
				currentBalance: '1000000000000000000',
				address: '0xTestAddress',
				network: 'base-sepolia',
			});
		});

		it('includes timestamp in change data', async () => {
			staticData.lastBalances = { ETH: '0' };
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).not.toBeNull();
			expect(result![0][0].json).toHaveProperty('timestamp');
			expect(typeof result![0][0].json.timestamp).toBe('string');
		});

		it('detects new token appearing', async () => {
			staticData.lastBalances = { ETH: '1000000000000000000' };
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).not.toBeNull();
			expect(result![0]).toHaveLength(1);
			expect(result![0][0].json).toMatchObject({
				token: 'USDC',
				previousBalance: '0',
				currentBalance: '50000000',
			});
		});

		it('detects token disappearing', async () => {
			staticData.lastBalances = {
				ETH: '1000000000000000000',
				USDC: '50000000',
				WBTC: '100000000',
			};
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).not.toBeNull();
			const changes = result![0];
			const wbtcChange = changes.find((c) => c.json.token === 'WBTC');
			expect(wbtcChange).toBeDefined();
			expect(wbtcChange!.json.currentBalance).toBe('0');
		});

		it('detects multiple simultaneous changes', async () => {
			staticData.lastBalances = { ETH: '0', USDC: '0' };
			const ctx = createPollContext();
			const result = await trigger.poll.call(ctx as never);

			expect(result).not.toBeNull();
			expect(result![0]).toHaveLength(2);
		});

		it('uses contractAddress as key when symbol is null', async () => {
			mockCdp.evm.listTokenBalances.mockResolvedValueOnce({
				balances: [
					{
						token: { symbol: null, contractAddress: '0xCustomToken' },
						amount: '999',
					},
				],
			});
			staticData.lastBalances = {};
			const ctx = createPollContext();
			await trigger.poll.call(ctx as never);

			expect(staticData.lastBalances).toEqual({ '0xCustomToken': '999' });
		});

		it('falls back to "unknown" when both symbol and contractAddress are null', async () => {
			mockCdp.evm.listTokenBalances.mockResolvedValueOnce({
				balances: [
					{
						token: { symbol: null, contractAddress: null },
						amount: '123',
					},
				],
			});
			staticData.lastBalances = {};
			const ctx = createPollContext();
			await trigger.poll.call(ctx as never);

			expect(staticData.lastBalances).toEqual({ unknown: '123' });
		});

		it('passes correct parameters to CDP SDK', async () => {
			const ctx = createPollContext({ address: '0xMyAddr', network: 'ethereum' });
			await trigger.poll.call(ctx as never);

			expect(mockCdp.evm.listTokenBalances).toHaveBeenCalledWith({
				address: '0xMyAddr',
				network: 'ethereum',
			});
		});

		it('updates stored balances after each poll', async () => {
			staticData.lastBalances = { ETH: '500' };
			const ctx = createPollContext();
			await trigger.poll.call(ctx as never);

			expect(staticData.lastBalances).toEqual({
				ETH: '1000000000000000000',
				USDC: '50000000',
			});
		});
	});
});
