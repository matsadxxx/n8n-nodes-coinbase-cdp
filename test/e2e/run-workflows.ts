/**
 * E2E Workflow Runner
 *
 * Runs example workflows against a live n8n instance with real CDP credentials.
 * If N8N_URL is set, connects to that instance. Otherwise, auto-spawns n8n.
 *
 * Usage:
 *   npm run test:e2e                    # auto-spawn n8n on port 5679
 *   npm run test:e2e:ui                 # same, but keep n8n running after tests
 *   N8N_URL=http://localhost:5678 npm run test:e2e  # use external instance
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';

const N8N_E2E_PORT = process.env.N8N_E2E_PORT || '5679';
const DEFAULT_N8N_URL = `http://localhost:${N8N_E2E_PORT}`;
const N8N_EMAIL = process.env.N8N_EMAIL || 'test@test.com';
const N8N_PASSWORD = process.env.N8N_PASSWORD || 'TestPass123!';
const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 30000;
const SPAWN_TIMEOUT = 60000;
const KEEP_RUNNING = process.argv.includes('--keep-running');

let n8nUrl = process.env.N8N_URL || '';
let spawnedProc: ChildProcess | null = null;
let spawnedTmpDir: string | null = null;

// ── HTTP helper ──────────────────────────────────────────────────────────────

function req(
	method: string,
	urlPath: string,
	body?: Record<string, unknown>,
	cookie?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const url = new URL(urlPath, n8nUrl);
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

// ── n8n spawn/teardown ──────────────────────────────────────────────────────

function cleanup(): void {
	if (spawnedProc?.pid) {
		// Kill the entire process group (npx + n8n child)
		try { process.kill(-spawnedProc.pid, 'SIGTERM'); } catch { /* already dead */ }
		spawnedProc = null;
	}
	if (spawnedTmpDir) {
		fs.rmSync(spawnedTmpDir, { recursive: true, force: true });
		spawnedTmpDir = null;
	}
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

async function setupOwner(): Promise<void> {
	const res = await req('POST', '/rest/owner/setup', {
		email: N8N_EMAIL,
		firstName: 'E2E',
		lastName: 'Test',
		password: N8N_PASSWORD,
	});
	if (res.status !== 200) {
		throw new Error(`Owner setup failed (${res.status}): ${res.body.substring(0, 200)}`);
	}
}

async function spawnN8n(): Promise<void> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-e2e-'));
	spawnedTmpDir = tmpDir;

	console.log(`Spawning n8n on port ${N8N_E2E_PORT} (user folder: ${tmpDir})`);

	const proc = spawn('npx', ['n8n', 'start'], {
		env: {
			...process.env,
			N8N_USER_FOLDER: tmpDir,
			N8N_PORT: N8N_E2E_PORT,
			N8N_CUSTOM_EXTENSIONS: process.cwd(),
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_PERSONALIZATION_ENABLED: 'false',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	});
	spawnedProc = proc;

	// Wait for "Editor is now accessible" — the definitive signal that
	// controllers are registered and the REST API is ready.
	const ready = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`n8n did not become ready within ${SPAWN_TIMEOUT / 1000}s`));
		}, SPAWN_TIMEOUT);

		proc.stdout?.on('data', (data: Buffer) => {
			const line = data.toString().trim();
			if (line) console.log(`  [n8n] ${line}`);
			if (data.toString().includes('Editor is now accessible')) {
				clearTimeout(timeout);
				resolve();
			}
		});
		proc.stderr?.on('data', (data: Buffer) => {
			const line = data.toString().trim();
			if (line) console.log(`  [n8n:err] ${line}`);
		});
		proc.on('exit', (code) => {
			clearTimeout(timeout);
			if (spawnedProc === proc) {
				spawnedProc = null;
			}
			reject(new Error(`n8n exited unexpectedly with code ${code}`));
		});
	});

	n8nUrl = DEFAULT_N8N_URL;
	await ready;
	console.log('n8n is ready\n');

	await setupOwner();
	console.log('Owner account created\n');
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

// Assertion test workflows with IF + StopAndError nodes for output validation
const TEST_WORKFLOWS_DIR = path.join(process.cwd(), 'test', 'e2e', 'workflows');
const TEST_WORKFLOWS = [
	'e2e-evm-account.json',
	'e2e-multi-chain-accounts.json',
	'e2e-faucet.json',
	'e2e-transfer.json',
	'e2e-swap-quote.json',
	'e2e-policy-lifecycle.json',
];

async function main() {
	console.log('=== n8n E2E Workflow Runner ===\n');

	const isExternalInstance = !!process.env.N8N_URL;

	if (isExternalInstance) {
		n8nUrl = process.env.N8N_URL!;
		console.log(`Using external n8n at ${n8nUrl}\n`);
		try {
			await req('GET', '/healthz/readiness');
		} catch {
			console.error(`ERROR: n8n is not reachable at ${n8nUrl}`);
			process.exit(1);
		}
	} else {
		await spawnN8n();
	}

	try {
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

		// ── Assertion test workflows ──
		console.log('\n--- Assertion Test Workflows ---\n');

		for (const file of TEST_WORKFLOWS) {
			const filePath = path.join(TEST_WORKFLOWS_DIR, file);
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

		// ── Keep running or exit ──
		if (KEEP_RUNNING && !isExternalInstance && spawnedProc) {
			console.log(`n8n is running at ${n8nUrl}`);
			console.log(`  Login: ${N8N_EMAIL} / ${N8N_PASSWORD}`);
			console.log('  Press Ctrl+C to stop\n');
			await new Promise<void>((resolve) => {
				process.on('SIGINT', () => resolve());
			});
		}

		process.exit(failed > 0 ? 1 : 0);
	} finally {
		if (!KEEP_RUNNING) {
			cleanup();
		}
	}
}

main().catch((e) => {
	cleanup();
	console.error('Fatal:', (e as Error).message);
	process.exit(1);
});
