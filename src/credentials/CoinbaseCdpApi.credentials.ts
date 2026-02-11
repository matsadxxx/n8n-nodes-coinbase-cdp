import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class CoinbaseCdpApi implements ICredentialType {
	name = 'coinbaseCdpApi';
	displayName = 'Coinbase CDP API';
	documentationUrl = 'https://docs.cdp.coinbase.com/';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key ID',
			name: 'apiKeyId',
			type: 'string',
			default: '',
			required: true,
			description: 'Your CDP API Key ID from the Coinbase Developer Portal',
		},
		{
			displayName: 'API Key Secret',
			name: 'apiKeySecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your CDP API Key Secret (ES256 private key in PEM format)',
		},
		{
			displayName: 'Wallet Secret',
			name: 'walletSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Your CDP Wallet Secret for signing transactions. Leave empty for read-only operations.',
		},
	];
}
