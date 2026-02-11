import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function swapTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'swap_tokens',
		description:
			'Swap one token for another on an EVM network. ' +
			'Supported networks: Base, Ethereum (mainnet and testnet). ' +
			'Specify tokens by symbol (e.g. "eth", "usdc") or contract address. ' +
			'Amount is in human-readable units of the source token.',
		schema: z.object({
			accountName: z.string().describe('The name of the account performing the swap'),
			fromToken: z
				.string()
				.describe('Token to swap from - symbol (e.g. "eth") or contract address'),
			toToken: z
				.string()
				.describe('Token to swap to - symbol (e.g. "usdc") or contract address'),
			fromAmount: z
				.string()
				.describe('Amount of source token in human-readable units (e.g. "0.01")'),
			network: z
				.string()
				.describe('Network for the swap (e.g. "base", "base-sepolia", "ethereum")'),
		}) as z.ZodObject<z.ZodRawShape>,
		func: async (input) => {
			const account = await cdp.evm.getOrCreateAccount({
				name: input.accountName as string,
			});
			const result = await account.swap({
				fromToken: input.fromToken as `0x${string}`,
				toToken: input.toToken as `0x${string}`,
				fromAmount: input.fromAmount as string as unknown as bigint,
				network: input.network as 'base',
			});
			return JSON.stringify({
				transactionHash: result.transactionHash,
				from: account.address,
				fromToken: input.fromToken,
				toToken: input.toToken,
				fromAmount: input.fromAmount,
				network: input.network,
			});
		},
	});
}
