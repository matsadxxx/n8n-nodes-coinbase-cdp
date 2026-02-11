import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { parseEther } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function nativeTransferTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'native_transfer',
		description:
			'Transfer native cryptocurrency (ETH, MATIC, AVAX, etc.) from your wallet to another address. ' +
			'You must specify the amount in whole units (e.g. "0.01" for 0.01 ETH). ' +
			'Do NOT use this for ERC-20 token transfers - use erc20_transfer instead.',
		schema: z.object({
			accountName: z.string().describe('The name of the sender account'),
			to: z.string().describe('The destination wallet address (0x...)'),
			amount: z.string().describe('Amount to transfer in whole units (e.g. "0.01")'),
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
				amount: parseEther(input.amount as string),
				token: 'eth',
				network: input.network as 'base-sepolia',
			});
			return JSON.stringify({
				transactionHash: result.transactionHash,
				from: account.address,
				to: input.to,
				amount: input.amount,
				network: input.network,
			});
		},
	});
}
