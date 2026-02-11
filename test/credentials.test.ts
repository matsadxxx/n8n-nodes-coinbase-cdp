import { CoinbaseCdpApi } from '../src/credentials/CoinbaseCdpApi.credentials';

describe('CoinbaseCdpApi Credentials', () => {
	let credentials: CoinbaseCdpApi;

	beforeEach(() => {
		credentials = new CoinbaseCdpApi();
	});

	it('has correct credential name', () => {
		expect(credentials.name).toBe('coinbaseCdpApi');
	});

	it('has correct display name', () => {
		expect(credentials.displayName).toBe('Coinbase CDP API');
	});

	it('has documentation URL', () => {
		expect(credentials.documentationUrl).toBe('https://docs.cdp.coinbase.com/');
	});

	it('has 3 properties', () => {
		expect(credentials.properties).toHaveLength(3);
	});

	it('has apiKeyId field', () => {
		const field = credentials.properties.find(p => p.name === 'apiKeyId');
		expect(field).toBeDefined();
		expect(field!.type).toBe('string');
		expect(field!.required).toBe(true);
	});

	it('has apiKeySecret field as password', () => {
		const field = credentials.properties.find(p => p.name === 'apiKeySecret');
		expect(field).toBeDefined();
		expect(field!.type).toBe('string');
		expect(field!.typeOptions).toEqual({ password: true });
		expect(field!.required).toBe(true);
	});

	it('has walletSecret field as optional password', () => {
		const field = credentials.properties.find(p => p.name === 'walletSecret');
		expect(field).toBeDefined();
		expect(field!.type).toBe('string');
		expect(field!.typeOptions).toEqual({ password: true });
		expect(field!.required).toBeUndefined();
	});
});
