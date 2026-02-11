import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function requestFaucetTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'request_faucet',
		description:
			'Request testnet tokens from a faucet. Only works on testnets. ' +
			'Available: ETH on base-sepolia/ethereum-sepolia, USDC on base-sepolia/ethereum-sepolia, SOL on solana-devnet.',
		schema: z.object({
			address: z.string().describe('The wallet address to receive testnet tokens'),
			token: z
				.string()
				.describe('Token to request: "eth", "usdc", or "sol"'),
			network: z
				.string()
				.describe(
					'Testnet network: "base-sepolia", "ethereum-sepolia", or "solana-devnet"',
				),
		}) as z.ZodObject<z.ZodRawShape>,
		func: async (input) => {
			const network = input.network as string;
			if (network.startsWith('solana')) {
				const result = await cdp.solana.requestFaucet({
					address: input.address as string,
					token: input.token as 'sol',
				});
				return JSON.stringify({
					success: true,
					transactionSignature: result.signature,
					address: input.address,
					token: input.token,
					network,
				});
			}
			const result = await cdp.evm.requestFaucet({
				address: input.address as `0x${string}`,
				token: input.token as 'eth',
				network: network as 'base-sepolia',
			});
			return JSON.stringify({
				success: true,
				transactionHash: result.transactionHash,
				address: input.address,
				token: input.token,
				network,
			});
		},
	});
}
