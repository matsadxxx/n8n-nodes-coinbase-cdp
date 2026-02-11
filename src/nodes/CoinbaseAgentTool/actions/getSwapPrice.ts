import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function getSwapPriceTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'get_swap_price',
		description:
			'Get a price quote for swapping one token for another without executing the trade. ' +
			'Use this to check prices before executing a swap. Returns estimated output amount.',
		schema: z.object({
			accountName: z.string().describe('The name of the account to quote for'),
			fromToken: z
				.string()
				.describe('Token to swap from - symbol (e.g. "eth") or contract address'),
			toToken: z
				.string()
				.describe('Token to swap to - symbol (e.g. "usdc") or contract address'),
			fromAmount: z
				.string()
				.describe('Amount of source token in human-readable units'),
			network: z
				.string()
				.describe('Network for the quote (e.g. "base", "ethereum")'),
		}) as z.ZodObject<z.ZodRawShape>,
		func: async (input) => {
			const account = await cdp.evm.getOrCreateAccount({
				name: input.accountName as string,
			});
			const quote = await account.quoteSwap({
				fromToken: input.fromToken as `0x${string}`,
				toToken: input.toToken as `0x${string}`,
				fromAmount: input.fromAmount as string as unknown as bigint,
				network: input.network as 'base',
			});
			if (!quote.liquidityAvailable) {
				return JSON.stringify({
					error: 'Insufficient liquidity for swap',
					fromToken: input.fromToken,
					toToken: input.toToken,
					fromAmount: input.fromAmount,
					liquidityAvailable: false,
					network: input.network,
				});
			}
			return JSON.stringify({
				fromToken: input.fromToken,
				toToken: input.toToken,
				fromAmount: input.fromAmount,
				toAmount: quote.toAmount,
				liquidityAvailable: true,
				network: input.network,
			});
		},
	});
}
