export interface EvmAccountResult {
	address: string;
	name?: string;
	network?: string;
}

export interface TransferResult {
	transactionHash: string;
	network: string;
	from: string;
	to: string;
	amount: string;
	token: string;
}

export interface SwapResult {
	transactionHash?: string;
	userOpHash?: string;
	network: string;
	fromToken: string;
	toToken: string;
	fromAmount: string;
}

export interface BalanceResult {
	address: string;
	network: string;
	token: string;
	amount: string;
}

export interface PolicyResult {
	id: string;
	scope: string;
	description: string;
	rules: unknown[];
}
