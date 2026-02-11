import { z } from 'zod';
import type { CdpClient } from '@coinbase/cdp-sdk';
import { createAgentTool } from '../../../shared/toolFactory';

export function walletDetailsTool(cdp: CdpClient) {
	return createAgentTool({
		name: 'get_wallet_details',
		description:
			'Get details about an EVM account (wallet) including its address. ' +
			'Use this to retrieve an existing account by name or create a new one.',
		schema: z.object({
			name: z.string().describe('The name of the account to get or create'),
		}) as z.ZodObject<z.ZodRawShape>,
		func: async (input) => {
			const account = await cdp.evm.getOrCreateAccount({
				name: input.name as string,
			});
			return JSON.stringify({
				address: account.address,
				name: input.name,
			});
		},
	});
}
