import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function erc20BalanceTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'get_balance',
		description:
			'Get the balance of a specific token for a given wallet address on a network. ' +
			'Supports native tokens (e.g. "eth") and ERC-20 tokens (e.g. "usdc" or contract address). ' +
			'Returns the balance in human-readable units.',
		schema: z.object({
			address: z.string().describe('The wallet address to check (0x...)'),
			token: z
				.string()
				.describe('Token symbol (e.g. "eth", "usdc") or contract address (0x...)'),
			network: z
				.string()
				.describe('The network to check (e.g. "base-sepolia", "base", "ethereum")'),
		}) as z.ZodObject<z.ZodRawShape>,
		func: async (input) => {
			const balances = await cdp.evm.listTokenBalances({
				address: input.address as `0x${string}`,
				network: input.network as 'base-sepolia',
			});
			const token = (input.token as string).toLowerCase();
			const matched = balances.balances.find(
				(b) =>
					b.token.symbol?.toLowerCase() === token ||
					b.token.contractAddress?.toLowerCase() === token,
			);
			if (matched) {
				return JSON.stringify({
					address: input.address,
					token: matched.token.symbol || input.token,
					amount: matched.amount,
					network: input.network,
				});
			}
			return JSON.stringify({
				address: input.address,
				token: input.token,
				amount: '0',
				network: input.network,
			});
		},
	});
}
