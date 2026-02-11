import { createMockCdpClient, createMockExecuteFunctions } from './helpers';
import { executeAccountOperation } from '../src/nodes/CoinbaseCdp/resources/account';
import { executeSolanaAccountOperation } from '../src/nodes/CoinbaseCdp/resources/solanaAccount';
import { executeSmartAccountOperation } from '../src/nodes/CoinbaseCdp/resources/smartAccount';
import { executeTransferOperation } from '../src/nodes/CoinbaseCdp/resources/transfer';
import { executeSwapOperation } from '../src/nodes/CoinbaseCdp/resources/swap';
import { executePolicyOperation } from '../src/nodes/CoinbaseCdp/resources/policy';
import { executeBalanceOperation } from '../src/nodes/CoinbaseCdp/resources/balance';
import type { CdpClient } from '@coinbase/cdp-sdk';
import type { IExecuteFunctions } from 'n8n-workflow';

function mockContext(params: Record<string, unknown>) {
	return {
		getNodeParameter: jest.fn((name: string, _i: number, fallback?: unknown) => {
			return params[name] ?? fallback;
		}),
	} as unknown as IExecuteFunctions;
}

describe('CoinbaseCdp Resource Operations', () => {
	let mockCdp: ReturnType<typeof createMockCdpClient>;

	beforeEach(() => {
		mockCdp = createMockCdpClient();
	});

	describe('account', () => {
		it('getOrCreate returns address', async () => {
			const ctx = mockContext({ accountName: 'TestAccount' });
			const result = await executeAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'getOrCreate', 0,
			);
			expect(result).toEqual({
				address: '0x1234567890abcdef1234567890abcdef12345678',
				name: 'TestAccount',
			});
		});

		it('listBalances returns token list', async () => {
			const ctx = mockContext({ address: '0xtest', network: 'base-sepolia' });
			const result = await executeAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'listBalances', 0,
			) as { balances: unknown[] };
			expect(result.balances).toHaveLength(2);
		});

		it('listBalances returns address and network', async () => {
			const ctx = mockContext({ address: '0xAddr', network: 'ethereum' });
			const result = await executeAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'listBalances', 0,
			) as { address: string; network: string };
			expect(result.address).toBe('0xAddr');
			expect(result.network).toBe('ethereum');
		});

		it('requestFaucet returns tx hash', async () => {
			const ctx = mockContext({
				address: '0xtest', faucetNetwork: 'base-sepolia', faucetToken: 'eth',
			});
			const result = await executeAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'requestFaucet', 0,
			) as { transactionHash: string };
			expect(result.transactionHash).toBe('0xfaucethash123');
		});

		it('requestFaucet returns address and token', async () => {
			const ctx = mockContext({
				address: '0xMyAddr', faucetNetwork: 'ethereum-sepolia', faucetToken: 'usdc',
			});
			const result = await executeAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'requestFaucet', 0,
			) as { address: string; token: string; network: string };
			expect(result.address).toBe('0xMyAddr');
			expect(result.token).toBe('usdc');
			expect(result.network).toBe('ethereum-sepolia');
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({});
			await expect(
				executeAccountOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown account operation: invalid');
		});
	});

	describe('solanaAccount', () => {
		it('getOrCreate returns Solana address', async () => {
			const ctx = mockContext({ accountName: 'SolWallet' });
			const result = await executeSolanaAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'getOrCreate', 0,
			);
			expect(result).toEqual({
				address: 'SoLaNaAdDrEsS1234567890abcdef',
				name: 'SolWallet',
			});
		});

		it('requestFaucet returns signature', async () => {
			const ctx = mockContext({ address: 'SolAddr', faucetToken: 'sol' });
			const result = await executeSolanaAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'requestFaucet', 0,
			) as { signature: string };
			expect(result.signature).toBe('solana_faucet_sig_123');
		});

		it('requestFaucet returns metadata', async () => {
			const ctx = mockContext({ address: 'SolAddr2', faucetToken: 'usdc' });
			const result = await executeSolanaAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'requestFaucet', 0,
			) as { address: string; token: string; network: string };
			expect(result.address).toBe('SolAddr2');
			expect(result.token).toBe('usdc');
			expect(result.network).toBe('solana-devnet');
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({});
			await expect(
				executeSolanaAccountOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown solanaAccount operation: invalid');
		});
	});

	describe('smartAccount', () => {
		it('getOrCreate returns smart account address', async () => {
			const ctx = mockContext({
				ownerAccountName: 'Owner', smartAccountName: 'MySmartWallet',
			});
			const result = await executeSmartAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'getOrCreate', 0,
			);
			expect(result).toEqual({
				address: '0xsmartaccount1234567890abcdef1234567890ab',
				ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
				ownerName: 'Owner',
				smartAccountName: 'MySmartWallet',
			});
		});

		it('getOrCreate with empty smartAccountName sets undefined', async () => {
			const ctx = mockContext({
				ownerAccountName: 'Owner', smartAccountName: '',
			});
			const result = await executeSmartAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'getOrCreate', 0,
			) as { smartAccountName?: string };
			expect(result.smartAccountName).toBeUndefined();
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({});
			await expect(
				executeSmartAccountOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown smartAccount operation: invalid');
		});
	});

	describe('transfer', () => {
		it('sendNative transfers ETH', async () => {
			const ctx = mockContext({
				accountName: 'Sender', to: '0xrecipient', amount: '0.01', network: 'base-sepolia',
			});
			const result = await executeTransferOperation(
				ctx, mockCdp as unknown as CdpClient, 'sendNative', 0,
			) as { transactionHash: string };
			expect(result.transactionHash).toBe('0xmocktxhash123');
		});

		it('sendNative returns full metadata', async () => {
			const ctx = mockContext({
				accountName: 'Sender', to: '0xrecip', amount: '1.5', network: 'ethereum',
			});
			const result = await executeTransferOperation(
				ctx, mockCdp as unknown as CdpClient, 'sendNative', 0,
			) as { from: string; to: string; amount: string; token: string; network: string };
			expect(result.from).toBe('0x1234567890abcdef1234567890abcdef12345678');
			expect(result.to).toBe('0xrecip');
			expect(result.amount).toBe('1.5');
			expect(result.token).toBe('eth');
			expect(result.network).toBe('ethereum');
		});

		it('sendErc20 transfers token', async () => {
			const ctx = mockContext({
				accountName: 'Sender', to: '0xrecipient', amount: '10', token: 'usdc',
				network: 'base-sepolia',
			});
			const result = await executeTransferOperation(
				ctx, mockCdp as unknown as CdpClient, 'sendErc20', 0,
			) as { token: string };
			expect(result.token).toBe('usdc');
		});

		it('sendErc20 returns full metadata', async () => {
			const ctx = mockContext({
				accountName: 'Sender', to: '0xrecip', amount: '50', token: 'dai',
				network: 'base',
			});
			const result = await executeTransferOperation(
				ctx, mockCdp as unknown as CdpClient, 'sendErc20', 0,
			) as { transactionHash: string; from: string; to: string; amount: string; token: string; network: string };
			expect(result.transactionHash).toBe('0xmocktxhash123');
			expect(result.from).toBe('0x1234567890abcdef1234567890abcdef12345678');
			expect(result.token).toBe('dai');
			expect(result.network).toBe('base');
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({
				accountName: 'Sender', to: '0xrecip', amount: '1', network: 'base',
			});
			await expect(
				executeTransferOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown transfer operation: invalid');
		});
	});

	describe('swap', () => {
		it('execute returns tx hash', async () => {
			const ctx = mockContext({
				accountName: 'Trader', fromToken: 'eth', toToken: 'usdc',
				fromAmount: '0.5', network: 'base',
			});
			const result = await executeSwapOperation(
				ctx, mockCdp as unknown as CdpClient, 'execute', 0,
			) as { transactionHash: string };
			expect(result.transactionHash).toBe('0xmockswaphash123');
		});

		it('execute returns full metadata', async () => {
			const ctx = mockContext({
				accountName: 'Trader', fromToken: 'eth', toToken: 'usdc',
				fromAmount: '1', network: 'ethereum',
			});
			const result = await executeSwapOperation(
				ctx, mockCdp as unknown as CdpClient, 'execute', 0,
			) as { from: string; fromToken: string; toToken: string; fromAmount: string; network: string };
			expect(result.from).toBe('0x1234567890abcdef1234567890abcdef12345678');
			expect(result.fromToken).toBe('eth');
			expect(result.toToken).toBe('usdc');
			expect(result.fromAmount).toBe('1');
			expect(result.network).toBe('ethereum');
		});

		it('quote returns liquidity info', async () => {
			const ctx = mockContext({
				accountName: 'Trader', fromToken: 'eth', toToken: 'usdc',
				fromAmount: '1', network: 'base',
			});
			const result = await executeSwapOperation(
				ctx, mockCdp as unknown as CdpClient, 'quote', 0,
			) as { liquidityAvailable: boolean };
			expect(result.liquidityAvailable).toBe(true);
		});

		it('quote returns no-liquidity result', async () => {
			mockCdp._mockAccount.quoteSwap.mockResolvedValueOnce({
				liquidityAvailable: false,
			});
			const ctx = mockContext({
				accountName: 'Trader', fromToken: 'eth', toToken: 'usdc',
				fromAmount: '1', network: 'base',
			});
			const result = await executeSwapOperation(
				ctx, mockCdp as unknown as CdpClient, 'quote', 0,
			) as { liquidityAvailable: boolean; fromToken: string; toToken: string };
			expect(result.liquidityAvailable).toBe(false);
			expect(result.fromToken).toBe('eth');
			expect(result.toToken).toBe('usdc');
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({
				accountName: 'Trader', fromToken: 'eth', toToken: 'usdc',
				fromAmount: '1', network: 'base',
			});
			await expect(
				executeSwapOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown swap operation: invalid');
		});
	});

	describe('policy', () => {
		it('list returns policies', async () => {
			const ctx = mockContext({});
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'list', 0,
			) as unknown as { policies: { policies: unknown[] } };
			expect(result.policies.policies).toHaveLength(1);
		});

		it('get returns single policy', async () => {
			const ctx = mockContext({ policyId: 'policy-1' });
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'get', 0,
			) as { id: string };
			expect(result.id).toBe('policy-1');
		});

		it('create returns new policy', async () => {
			const ctx = mockContext({ policyJson: '{"scope":"account","rules":[]}' });
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'create', 0,
			) as { id: string };
			expect(result.id).toBe('policy-2');
		});

		it('create accepts pre-parsed JSON object', async () => {
			const ctx = mockContext({ policyJson: { scope: 'account', rules: [] } });
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'create', 0,
			) as { id: string };
			expect(result.id).toBe('policy-2');
			expect(mockCdp.policies.createPolicy).toHaveBeenCalledWith({
				policy: { scope: 'account', rules: [] },
			});
		});

		it('update returns updated policy', async () => {
			const ctx = mockContext({
				policyId: 'policy-1',
				policyJson: '{"scope":"account","rules":[{"action":"allow"}]}',
			});
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'update', 0,
			) as { id: string; description: string };
			expect(result.id).toBe('policy-1');
			expect(result.description).toBe('Updated policy');
			expect(mockCdp.policies.updatePolicy).toHaveBeenCalledWith({
				id: 'policy-1',
				policy: { scope: 'account', rules: [{ action: 'allow' }] },
			});
		});

		it('update accepts pre-parsed JSON object', async () => {
			const ctx = mockContext({
				policyId: 'policy-1',
				policyJson: { scope: 'account', rules: [] },
			});
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'update', 0,
			) as { id: string };
			expect(result.id).toBe('policy-1');
		});

		it('delete returns confirmation', async () => {
			const ctx = mockContext({ policyId: 'policy-1' });
			const result = await executePolicyOperation(
				ctx, mockCdp as unknown as CdpClient, 'delete', 0,
			) as { deleted: boolean; policyId: string };
			expect(result.deleted).toBe(true);
			expect(result.policyId).toBe('policy-1');
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({});
			await expect(
				executePolicyOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown policy operation: invalid');
		});
	});

	describe('balance', () => {
		it('listTokens returns balances', async () => {
			const ctx = mockContext({ address: '0xtest', network: 'base-sepolia' });
			const result = await executeBalanceOperation(
				ctx, mockCdp as unknown as CdpClient, 'listTokens', 0,
			) as { balances: unknown[] };
			expect(result.balances).toHaveLength(2);
		});

		it('listTokens returns address and network', async () => {
			const ctx = mockContext({ address: '0xMyAddr', network: 'polygon' });
			const result = await executeBalanceOperation(
				ctx, mockCdp as unknown as CdpClient, 'listTokens', 0,
			) as { address: string; network: string };
			expect(result.address).toBe('0xMyAddr');
			expect(result.network).toBe('polygon');
		});

		it('listTokens maps token info correctly', async () => {
			const ctx = mockContext({ address: '0xtest', network: 'base' });
			const result = await executeBalanceOperation(
				ctx, mockCdp as unknown as CdpClient, 'listTokens', 0,
			) as unknown as { balances: Array<{ token: string; amount: string }> };
			expect(result.balances[0].token).toBe('ETH');
			expect(result.balances[0].amount).toBe('1000000000000000000');
			expect(result.balances[1].token).toBe('USDC');
			expect(result.balances[1].amount).toBe('50000000');
		});

		it('listTokens falls back to contractAddress for token name', async () => {
			mockCdp.evm.listTokenBalances.mockResolvedValueOnce({
				balances: [
					{
						token: { symbol: null, contractAddress: '0xCustomToken' },
						amount: '999',
					},
				],
			});
			const ctx = mockContext({ address: '0xtest', network: 'base' });
			const result = await executeBalanceOperation(
				ctx, mockCdp as unknown as CdpClient, 'listTokens', 0,
			) as { balances: Array<{ token: string | null }> };
			expect(result.balances[0].token).toBe('0xCustomToken');
		});

		it('account listBalances falls back to contractAddress for token name', async () => {
			mockCdp.evm.listTokenBalances.mockResolvedValueOnce({
				balances: [
					{
						token: { symbol: null, contractAddress: '0xCustom' },
						amount: '42',
					},
				],
			});
			const ctx = mockContext({ address: '0xtest', network: 'base' });
			const result = await executeAccountOperation(
				ctx, mockCdp as unknown as CdpClient, 'listBalances', 0,
			) as unknown as { balances: Array<{ token: string | null }> };
			expect(result.balances[0].token).toBe('0xCustom');
		});

		it('throws on unknown operation', async () => {
			const ctx = mockContext({});
			await expect(
				executeBalanceOperation(ctx, mockCdp as unknown as CdpClient, 'invalid', 0),
			).rejects.toThrow('Unknown balance operation: invalid');
		});
	});
});
