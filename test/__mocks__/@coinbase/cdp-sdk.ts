export class CdpClient {
	evm = {};
	solana = {};
	policies = {};
}

export function parseEther(value: string): bigint {
	const parts = value.split('.');
	const whole = parts[0] || '0';
	const frac = (parts[1] || '').padEnd(18, '0').slice(0, 18);
	return BigInt(whole + frac);
}

export function parseUnits(value: string, decimals: number): bigint {
	const parts = value.split('.');
	const whole = parts[0] || '0';
	const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
	return BigInt(whole + frac);
}
