import { CdpClient } from '@coinbase/cdp-sdk';
import type { IExecuteFunctions, ISupplyDataFunctions, IPollFunctions } from 'n8n-workflow';

type CredentialContext = IExecuteFunctions | ISupplyDataFunctions | IPollFunctions;

export async function getCdpClient(context: CredentialContext): Promise<CdpClient> {
	const credentials = await context.getCredentials('coinbaseCdpApi');

	return new CdpClient({
		apiKeyId: credentials.apiKeyId as string,
		apiKeySecret: credentials.apiKeySecret as string,
		walletSecret: (credentials.walletSecret as string) || undefined,
	});
}
