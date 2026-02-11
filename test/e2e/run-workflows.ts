/**
 * E2E Workflow Runner
 *
 * Runs example workflows against a live n8n instance with real CDP credentials.
 * Requires: n8n running on localhost:5678 (npm run dev) and .env with CDP keys.
 *
 * Usage: npm run test:e2e
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const N8N_EMAIL = process.env.N8N_EMAIL || 'test@test.com';
const N8N_PASSWORD = process.env.N8N_PASSWORD || 'TestPass123!';
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 30000;

// ── HTTP helper ──────────────────────────────────────────────────────────────

function req(
	method: string,
	urlPath: string,
	body?: Record<string, unknown>,
	cookie?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const url = new URL(urlPath, N8N_URL);
		const data = body ? JSON.stringify(body) : '';
		const headers: Record<string, string> = {};
		if (cookie) headers.Cookie = cookie;
		if (body) {
			headers['Content-Type'] = 'application/json';
			headers['Content-Length'] = String(Buffer.byteLength(data));
		}
		const r = http.request(
			{ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
			(res) => {
				let d = '';
				res.on('data', (c: Buffer) => (d += c));
				res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: d }));
			},
		);
		r.on('error', reject);
		if (data) r.write(data);
		r.end();
	});
}

// ── Flatted parser (n8n stores execution data in flatted format) ─────────────

function parseFlatted(raw: string): unknown {
	// Use flatted from n8n's dependencies
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { parse } = require(path.join(process.cwd(), 'node_modules/flatted'));
		return parse(raw);
	} catch {
		return JSON.parse(raw);
	}
}

// ── Load .env ────────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
	const envPath = path.join(process.cwd(), '.env');
	if (!fs.existsSync(envPath)) {
		throw new Error('.env file not found. Copy .env.example and fill in your CDP credentials.');
	}
	const env: Record<string, string> = {};
	fs.readFileSync(envPath, 'utf8')
		.split('\n')
		.forEach((line) => {
			const idx = line.indexOf('=');
			if (idx > 0) env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
		});
	if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
		throw new Error('.env missing CDP_API_KEY_ID or CDP_API_KEY_SECRET');
	}
	return env;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
	const res = await req('POST', '/rest/login', {
		emailOrLdapLoginId: N8N_EMAIL,
		password: N8N_PASSWORD,
	});
	if (res.status !== 200) {
		throw new Error(`Login failed (${res.status}): ${res.body.substring(0, 200)}`);
	}
	const cookies = res.headers['set-cookie'];
	if (!cookies || cookies.length === 0) {
		throw new Error('No session cookie returned from login');
	}
	return cookies[0].split(';')[0];
}

// ── Credential creation ──────────────────────────────────────────────────────

async function createCredential(cookie: string, env: Record<string, string>): Promise<string> {
	const res = await req(
		'POST',
		'/rest/credentials',
		{
			name: `CDP E2E ${Date.now()}`,
			type: 'coinbaseCdpApi',
			data: {
				apiKeyId: env.CDP_API_KEY_ID,
				apiKeySecret: env.CDP_API_KEY_SECRET,
				walletSecret: env.CDP_WALLET_SECRET || '',
			},
		},
		cookie,
	);
	if (res.status !== 200) {
		throw new Error(`Credential creation failed (${res.status}): ${res.body.substring(0, 200)}`);
	}
	return JSON.parse(res.body).data.id;
}

// ── Workflow helpers ─────────────────────────────────────────────────────────

function patchCredentials(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	workflow: any,
	credId: string,
): void {
	for (const node of workflow.nodes) {
		if (node.credentials?.coinbaseCdpApi) {
			node.credentials.coinbaseCdpApi = { id: credId, name: 'CDP E2E' };
		}
	}
}

function findTriggerNode(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	workflow: any,
): string | null {
	for (const node of workflow.nodes) {
		if (
			node.type === 'n8n-nodes-base.manualTrigger' ||
			node.type.includes('manualTrigger')
		) {
			return node.name;
		}
	}
	return null;
}

interface NodeResult {
	name: string;
	status: string;
	time: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	output?: any;
	error?: string;
}

async function executeWorkflow(
	cookie: string,
	workflowFile: string,
	credId: string,
): Promise<{ status: string; duration: number; nodes: NodeResult[] }> {
	const raw = fs.readFileSync(workflowFile, 'utf8');
	const workflow = JSON.parse(raw);

	const triggerName = findTriggerNode(workflow);
	if (!triggerName) {
		return { status: 'skipped', duration: 0, nodes: [] };
	}

	patchCredentials(workflow, credId);
	workflow.name = `E2E: ${path.basename(workflowFile, '.json')} ${Date.now()}`;

	// Create workflow
	const createRes = await req('POST', '/rest/workflows', workflow, cookie);
	if (createRes.status !== 200) {
		throw new Error(`Workflow creation failed (${createRes.status}): ${createRes.body.substring(0, 200)}`);
	}
	const wf = JSON.parse(createRes.body).data;

	// Execute
	const execRes = await req(
		'POST',
		`/rest/workflows/${wf.id}/run`,
		{
			workflowData: wf,
			triggerToStartFrom: { name: triggerName, data: {} },
		},
		cookie,
	);
	if (execRes.status !== 200) {
		throw new Error(`Execution failed (${execRes.status}): ${execRes.body.substring(0, 200)}`);
	}
	const executionId = JSON.parse(execRes.body).data?.executionId;

	// Poll for result
	const startTime = Date.now();
	while (Date.now() - startTime < POLL_TIMEOUT) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL));
		const pollRes = await req('GET', `/rest/executions/${executionId}?includeData=true`, undefined, cookie);
		const detail = JSON.parse(pollRes.body).data;

		if (detail.status === 'running' || detail.status === 'new') {
			continue;
		}

		const duration = new Date(detail.stoppedAt).getTime() - new Date(detail.startedAt).getTime();

		// Parse flatted execution data
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let parsed: any;
		if (typeof detail.data === 'string') {
			parsed = parseFlatted(detail.data);
		} else if (Array.isArray(detail.data)) {
			parsed = parseFlatted(JSON.stringify(detail.data));
		} else {
			parsed = detail.data;
		}

		const runData = parsed?.resultData?.runData || {};
		const nodes: NodeResult[] = [];

		for (const [name, runs] of Object.entries(runData)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const run = Array.isArray(runs) ? (runs as any[])[0] : runs as any;
			const nodeResult: NodeResult = {
				name,
				status: run?.executionStatus || 'unknown',
				time: run?.executionTime || 0,
			};

			const output = run?.data?.main?.[0];
			if (Array.isArray(output)) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const items = output.map((item: any) => item?.json).filter(Boolean);
				if (items.length > 0) {
					nodeResult.output = items.length === 1 ? items[0] : items;
				}
			}

			if (run?.error) {
				nodeResult.error = run.error.message || JSON.stringify(run.error).substring(0, 200);
			}

			nodes.push(nodeResult);
		}

		// Cleanup: delete workflow
		await req('DELETE', `/rest/workflows/${wf.id}`, undefined, cookie);

		return { status: detail.status, duration, nodes };
	}

	return { status: 'timeout', duration: POLL_TIMEOUT, nodes: [] };
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Workflows that can be executed (have ManualTrigger and use CDP operations only)
const EXECUTABLE_WORKFLOWS = [
	'account-and-balance.json',
	'faucet-and-transfer.json',
	'multi-chain-accounts.json',
	'policy-management.json',
];

// Workflows that need external triggers, AI models, or funded wallets (validate structure only)
const VALIDATE_ONLY_WORKFLOWS = [
	'ai-agent-blockchain.json',
	'balance-monitor.json',
	'swap-tokens.json',
];

async function main() {
	console.log('=== n8n E2E Workflow Runner ===\n');

	// Verify n8n is accessible
	try {
		await req('GET', '/healthz');
	} catch {
		console.error('ERROR: n8n is not running. Start it with: npm run dev');
		process.exit(1);
	}

	const env = loadEnv();
	const cookie = await login();
	console.log('Logged in to n8n\n');

	const credId = await createCredential(cookie, env);
	console.log(`Credential created (id: ${credId})\n`);

	const examplesDir = path.join(process.cwd(), 'examples');
	let passed = 0;
	let failed = 0;
	let skipped = 0;

	// ── Execute workflows with ManualTrigger ──
	console.log('--- Executing Workflows ---\n');

	for (const file of EXECUTABLE_WORKFLOWS) {
		const filePath = path.join(examplesDir, file);
		const label = file.replace('.json', '');
		process.stdout.write(`  ${label}... `);

		try {
			const result = await executeWorkflow(cookie, filePath, credId);

			if (result.status === 'success') {
				const nodeInfo = result.nodes
					.map((n) => `${n.name}(${n.time}ms)`)
					.join(' -> ');
				console.log(`OK  ${result.duration}ms  [${nodeInfo}]`);

				for (const node of result.nodes) {
					if (node.output) {
						console.log(`    ${node.name}: ${JSON.stringify(node.output)}`);
					}
				}
				passed++;
			} else if (result.status === 'error') {
				const failedNode = result.nodes.find((n) => n.status !== 'success');
				console.log(`FAIL  ${failedNode?.name}: ${failedNode?.error || 'unknown error'}`);
				failed++;
			} else {
				console.log(`${result.status.toUpperCase()}`);
				failed++;
			}
		} catch (e) {
			console.log(`ERROR  ${(e as Error).message}`);
			failed++;
		}
	}

	// ── Validate-only workflows ──
	console.log('\n--- Validating Workflow Structure ---\n');

	for (const file of VALIDATE_ONLY_WORKFLOWS) {
		const filePath = path.join(examplesDir, file);
		const label = file.replace('.json', '');
		process.stdout.write(`  ${label}... `);

		try {
			const raw = fs.readFileSync(filePath, 'utf8');
			const workflow = JSON.parse(raw);

			// Validate structure
			const errors: string[] = [];
			if (!workflow.name) errors.push('missing name');
			if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) errors.push('missing nodes');
			if (!workflow.connections) errors.push('missing connections');

			// Check all CDP nodes have credentials
			for (const node of workflow.nodes) {
				if (node.type?.includes('coinbase') && !node.credentials?.coinbaseCdpApi) {
					errors.push(`${node.name} missing credentials`);
				}
			}

			// Check all connections reference existing nodes
			const nodeNames = new Set(workflow.nodes.map((n: { name: string }) => n.name));
			for (const sourceName of Object.keys(workflow.connections)) {
				if (!nodeNames.has(sourceName)) {
					errors.push(`connection from non-existent node: ${sourceName}`);
				}
			}

			if (errors.length > 0) {
				console.log(`INVALID  ${errors.join(', ')}`);
				failed++;
			} else {
				console.log(`VALID  (${workflow.nodes.length} nodes, ${Object.keys(workflow.connections).length} connections)`);
				skipped++;
			}
		} catch (e) {
			console.log(`ERROR  ${(e as Error).message}`);
			failed++;
		}
	}

	// ── Summary ──
	console.log('\n========================================');
	console.log(`  PASSED:    ${passed}`);
	console.log(`  VALIDATED: ${skipped}`);
	console.log(`  FAILED:    ${failed}`);
	console.log('========================================\n');

	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error('Fatal:', (e as Error).message);
	process.exit(1);
});
