import { createMockCdpClient } from './helpers';
import { walletDetailsTool } from '../src/nodes/CoinbaseAgentTool/actions/walletDetails';
import { nativeTransferTool } from '../src/nodes/CoinbaseAgentTool/actions/nativeTransfer';
import { erc20TransferTool } from '../src/nodes/CoinbaseAgentTool/actions/erc20Transfer';
import { erc20BalanceTool } from '../src/nodes/CoinbaseAgentTool/actions/erc20Balance';
import { swapTool } from '../src/nodes/CoinbaseAgentTool/actions/swap';
import { getSwapPriceTool } from '../src/nodes/CoinbaseAgentTool/actions/getSwapPrice';
import { requestFaucetTool } from '../src/nodes/CoinbaseAgentTool/actions/requestFaucet';
import type { CdpClient } from '@coinbase/cdp-sdk';

describe('CoinbaseAgentTool Actions', () => {
	let mockCdp: ReturnType<typeof createMockCdpClient>;

	beforeEach(() => {
		mockCdp = createMockCdpClient();
	});

	describe('walletDetailsTool', () => {
		it('returns account address for given name', async () => {
			const tool = walletDetailsTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({ name: 'TestWallet' });
			const parsed = JSON.parse(result);

			expect(parsed.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
			expect(parsed.name).toBe('TestWallet');
			expect(mockCdp.evm.getOrCreateAccount).toHaveBeenCalledWith({ name: 'TestWallet' });
		});

		it('returns error string on SDK failure', async () => {
			mockCdp.evm.getOrCreateAccount.mockRejectedValueOnce(new Error('Network timeout'));
			const tool = walletDetailsTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({ name: 'FailWallet' });
			expect(result).toBe('Error: Network timeout');
		});
	});

	describe('nativeTransferTool', () => {
		it('transfers ETH and returns tx hash', async () => {
			const tool = nativeTransferTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'MyWallet',
				to: '0xrecipient',
				amount: '0.01',
				network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);

			expect(parsed.transactionHash).toBe('0xmocktxhash123');
			expect(parsed.amount).toBe('0.01');
			expect(parsed.from).toBe('0x1234567890abcdef1234567890abcdef12345678');
			expect(parsed.to).toBe('0xrecipient');
			expect(parsed.network).toBe('base-sepolia');
			expect(mockCdp._mockAccount.transfer).toHaveBeenCalled();
		});

		it('returns error string on transfer failure', async () => {
			mockCdp._mockAccount.transfer.mockRejectedValueOnce(new Error('Insufficient funds'));
			const tool = nativeTransferTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'MyWallet', to: '0xrecip', amount: '999', network: 'base',
			});
			expect(result).toBe('Error: Insufficient funds');
		});
	});

	describe('erc20TransferTool', () => {
		it('transfers ERC-20 token', async () => {
			const tool = erc20TransferTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'MyWallet',
				to: '0xrecipient',
				amount: '10',
				token: 'usdc',
				network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);

			expect(parsed.transactionHash).toBe('0xmocktxhash123');
			expect(parsed.token).toBe('usdc');
			expect(parsed.amount).toBe('10');
		});

		it('returns error string on failure', async () => {
			mockCdp._mockAccount.transfer.mockRejectedValueOnce(new Error('Token not supported'));
			const tool = erc20TransferTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'W', to: '0x', amount: '1', token: 'xyz', network: 'base',
			});
			expect(result).toBe('Error: Token not supported');
		});
	});

	describe('erc20BalanceTool', () => {
		it('returns matching token balance by symbol', async () => {
			const tool = erc20BalanceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: 'ETH', network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);

			expect(parsed.amount).toBe('1000000000000000000');
			expect(parsed.token).toBe('ETH');
		});

		it('returns matching token balance case-insensitively', async () => {
			const tool = erc20BalanceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: 'eth', network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);
			expect(parsed.amount).toBe('1000000000000000000');
		});

		it('matches by contract address', async () => {
			const tool = erc20BalanceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: '0xusdc', network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);
			expect(parsed.amount).toBe('50000000');
		});

		it('returns token name from input when symbol is null but contractAddress matches', async () => {
			mockCdp.evm.listTokenBalances.mockResolvedValueOnce({
				balances: [
					{
						token: { symbol: null, contractAddress: '0xcustom' },
						amount: '777',
					},
				],
			});
			const tool = erc20BalanceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: '0xcustom', network: 'base',
			});
			const parsed = JSON.parse(result);
			expect(parsed.amount).toBe('777');
			expect(parsed.token).toBe('0xcustom');
		});

		it('returns 0 for unknown token', async () => {
			const tool = erc20BalanceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: 'UNKNOWN', network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);

			expect(parsed.amount).toBe('0');
			expect(parsed.token).toBe('UNKNOWN');
		});

		it('returns error string on SDK failure', async () => {
			mockCdp.evm.listTokenBalances.mockRejectedValueOnce(new Error('RPC error'));
			const tool = erc20BalanceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: 'ETH', network: 'base',
			});
			expect(result).toBe('Error: RPC error');
		});
	});

	describe('swapTool', () => {
		it('executes swap and returns hash', async () => {
			const tool = swapTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'MyWallet',
				fromToken: 'eth',
				toToken: 'usdc',
				fromAmount: '0.01',
				network: 'base',
			});
			const parsed = JSON.parse(result);

			expect(parsed.transactionHash).toBe('0xmockswaphash123');
			expect(parsed.fromToken).toBe('eth');
			expect(parsed.toToken).toBe('usdc');
			expect(mockCdp._mockAccount.swap).toHaveBeenCalled();
		});

		it('returns error string on swap failure', async () => {
			mockCdp._mockAccount.swap.mockRejectedValueOnce(new Error('Slippage too high'));
			const tool = swapTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'W', fromToken: 'eth', toToken: 'usdc', fromAmount: '1', network: 'base',
			});
			expect(result).toBe('Error: Slippage too high');
		});
	});

	describe('getSwapPriceTool', () => {
		it('returns quote with liquidity', async () => {
			const tool = getSwapPriceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'MyWallet',
				fromToken: 'eth',
				toToken: 'usdc',
				fromAmount: '1',
				network: 'base',
			});
			const parsed = JSON.parse(result);

			expect(parsed.liquidityAvailable).toBe(true);
			expect(parsed.toAmount).toBe('100000000');
			expect(parsed.fromToken).toBe('eth');
		});

		it('returns error when no liquidity', async () => {
			mockCdp._mockAccount.quoteSwap.mockResolvedValueOnce({
				liquidityAvailable: false,
			});
			const tool = getSwapPriceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'MyWallet',
				fromToken: 'eth',
				toToken: 'usdc',
				fromAmount: '1',
				network: 'base',
			});
			const parsed = JSON.parse(result);

			expect(parsed.liquidityAvailable).toBe(false);
			expect(parsed.error).toBeDefined();
		});

		it('returns error string on SDK failure', async () => {
			mockCdp._mockAccount.quoteSwap.mockRejectedValueOnce(new Error('API error'));
			const tool = getSwapPriceTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				accountName: 'W', fromToken: 'eth', toToken: 'usdc', fromAmount: '1', network: 'base',
			});
			expect(result).toBe('Error: API error');
		});
	});

	describe('requestFaucetTool', () => {
		it('requests EVM faucet tokens', async () => {
			const tool = requestFaucetTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: 'eth', network: 'base-sepolia',
			});
			const parsed = JSON.parse(result);

			expect(parsed.success).toBe(true);
			expect(parsed.transactionHash).toBe('0xfaucethash123');
			expect(parsed.network).toBe('base-sepolia');
		});

		it('requests Solana faucet tokens', async () => {
			const tool = requestFaucetTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: 'SoLaNaAddress', token: 'sol', network: 'solana-devnet',
			});
			const parsed = JSON.parse(result);

			expect(parsed.success).toBe(true);
			expect(parsed.transactionSignature).toBe('solana_faucet_sig_123');
			expect(parsed.network).toBe('solana-devnet');
		});

		it('distinguishes EVM from Solana by network prefix', async () => {
			const tool = requestFaucetTool(mockCdp as unknown as CdpClient);
			await tool.invoke({ address: '0xtest', token: 'eth', network: 'ethereum-sepolia' });
			expect(mockCdp.evm.requestFaucet).toHaveBeenCalled();
			expect(mockCdp.solana.requestFaucet).not.toHaveBeenCalled();
		});

		it('returns error string on faucet failure', async () => {
			mockCdp.evm.requestFaucet.mockRejectedValueOnce(new Error('Rate limited'));
			const tool = requestFaucetTool(mockCdp as unknown as CdpClient);
			const result = await tool.invoke({
				address: '0xtest', token: 'eth', network: 'base-sepolia',
			});
			expect(result).toBe('Error: Rate limited');
		});
	});
});
