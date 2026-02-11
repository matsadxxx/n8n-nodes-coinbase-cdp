import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function erc20TransferTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'erc20_transfer',
		description:
			'Transfer an ERC-20 token from your wallet to another address. ' +
			'You can specify common tokens by symbol (e.g. "usdc", "dai") or by contract address. ' +
			'The amount should be in human-readable units (e.g. "10" for 10 USDC).',
		schema: z.object({
			accountName: z.string().describe('The name of the sender account'),
			to: z.string().describe('The destination wallet address (0x...)'),
			amount: z.string().describe('Amount in human-readable units (e.g. "10" for 10 USDC)'),
			token: z
				.string()
				.describe('Token symbol (e.g. "usdc") or contract address (0x...)'),
			network: z
				.string()
				.describe('The network to use (e.g. "base-sepolia", "base", "ethereum")'),
		}) as z.ZodObject<z.ZodRawShape>,
		func: async (input) => {
			const account = await cdp.evm.getOrCreateAccount({
				name: input.accountName as string,
			});
			const result = await account.transfer({
				to: input.to as `0x${string}`,
				amount: input.amount as string as unknown as bigint,
				token: input.token as 'usdc',
				network: input.network as 'base-sepolia',
			});
			return JSON.stringify({
				transactionHash: result.transactionHash,
				from: account.address,
				to: input.to,
				amount: input.amount,
				token: input.token,
				network: input.network,
			});
		},
	});
}
