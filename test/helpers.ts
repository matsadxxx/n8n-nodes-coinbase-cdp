export function createMockCdpClient() {
	const mockAccount = {
		address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
		transfer: jest.fn().mockResolvedValue({
			transactionHash: '0xmocktxhash123',
		}),
		swap: jest.fn().mockResolvedValue({
			transactionHash: '0xmockswaphash123',
		}),
		quoteSwap: jest.fn().mockResolvedValue({
			liquidityAvailable: true,
			toAmount: '100000000',
		}),
	};

	const mockSmartAccount = {
		address: '0xsmartaccount1234567890abcdef1234567890ab' as `0x${string}`,
	};

	const mockSolanaAccount = {
		address: 'SoLaNaAdDrEsS1234567890abcdef',
	};

	return {
		evm: {
			getOrCreateAccount: jest.fn().mockResolvedValue(mockAccount),
			createAccount: jest.fn().mockResolvedValue(mockAccount),
			getOrCreateSmartAccount: jest.fn().mockResolvedValue(mockSmartAccount),
			listTokenBalances: jest.fn().mockResolvedValue({
				balances: [
					{
						token: { symbol: 'ETH', contractAddress: null },
						amount: '1000000000000000000',
					},
					{
						token: { symbol: 'USDC', contractAddress: '0xusdc' },
						amount: '50000000',
					},
				],
			}),
			requestFaucet: jest.fn().mockResolvedValue({
				transactionHash: '0xfaucethash123',
			}),
		},
		solana: {
			getOrCreateAccount: jest.fn().mockResolvedValue(mockSolanaAccount),
			createAccount: jest.fn().mockResolvedValue(mockSolanaAccount),
			requestFaucet: jest.fn().mockResolvedValue({
				signature: 'solana_faucet_sig_123',
			}),
		},
		policies: {
			listPolicies: jest.fn().mockResolvedValue({
				policies: [{ id: 'policy-1', description: 'Test policy' }],
			}),
			getPolicyById: jest.fn().mockResolvedValue({
				id: 'policy-1',
				description: 'Test policy',
				rules: [],
			}),
			createPolicy: jest.fn().mockResolvedValue({
				id: 'policy-2',
				description: 'New policy',
				rules: [],
			}),
			updatePolicy: jest.fn().mockResolvedValue({
				id: 'policy-1',
				description: 'Updated policy',
				rules: [],
			}),
			deletePolicy: jest.fn().mockResolvedValue(undefined),
		},
		_mockAccount: mockAccount,
		_mockSmartAccount: mockSmartAccount,
		_mockSolanaAccount: mockSolanaAccount,
	};
}

export function createMockExecuteFunctions(params: Record<string, unknown> = {}) {
	return {
		getNodeParameter: jest.fn((name: string, _i: number, fallback?: unknown) => {
			return params[name] ?? fallback;
		}),
		getCredentials: jest.fn().mockResolvedValue({
			apiKeyId: 'test-key-id',
			apiKeySecret: 'test-key-secret',
			walletSecret: 'test-wallet-secret',
		}),
		getInputData: jest.fn().mockReturnValue([{ json: {} }]),
		getNode: jest.fn().mockReturnValue({ name: 'Coinbase CDP' }),
		getWorkflowStaticData: jest.fn().mockReturnValue({}),
		continueOnFail: jest.fn().mockReturnValue(false),
		helpers: {
			returnJsonArray: jest.fn((data: unknown) => data),
		},
	};
}
