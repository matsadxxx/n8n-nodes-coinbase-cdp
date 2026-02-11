import { CdpClient } from '@coinbase/cdp-sdk';
import { getCdpClient } from '../src/shared/cdpClientFactory';

describe('cdpClientFactory', () => {
	it('creates CdpClient with credentials', async () => {
		const mockContext = {
			getCredentials: jest.fn().mockResolvedValue({
				apiKeyId: 'key-id-123',
				apiKeySecret: 'key-secret-456',
				walletSecret: 'wallet-secret-789',
			}),
		};

		const client = await getCdpClient(mockContext as never);
		expect(client).toBeInstanceOf(CdpClient);
		expect(mockContext.getCredentials).toHaveBeenCalledWith('coinbaseCdpApi');
	});

	it('creates CdpClient with empty walletSecret as undefined', async () => {
		const mockContext = {
			getCredentials: jest.fn().mockResolvedValue({
				apiKeyId: 'key-id-123',
				apiKeySecret: 'key-secret-456',
				walletSecret: '',
			}),
		};

		const client = await getCdpClient(mockContext as never);
		expect(client).toBeInstanceOf(CdpClient);
	});

	it('creates CdpClient without walletSecret', async () => {
		const mockContext = {
			getCredentials: jest.fn().mockResolvedValue({
				apiKeyId: 'key-id-123',
				apiKeySecret: 'key-secret-456',
			}),
		};

		const client = await getCdpClient(mockContext as never);
		expect(client).toBeInstanceOf(CdpClient);
	});
});
