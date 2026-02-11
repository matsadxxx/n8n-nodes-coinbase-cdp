# n8n-nodes-coinbase-cdp

n8n community node package for [Coinbase Developer Platform (CDP)](https://docs.cdp.coinbase.com/). Create wallets, transfer tokens, swap assets, and build AI-powered blockchain agents — all from n8n workflows.

**3 nodes. 7 resources. 16 operations. AI Agent tools built in.**

## Nodes

| Node | Type | Description |
|------|------|-------------|
| **Coinbase CDP** | Action | Deterministic blockchain operations — accounts, transfers, swaps, policies, balances |
| **Coinbase CDP Tool** | AI Tool | LLM-invocable tools for n8n AI Agent — wallets, transfers, swaps, balances, faucets |
| **Coinbase CDP Trigger** | Trigger | Poll for balance changes on any EVM address |

## Installation

### n8n Community Nodes (Recommended)

1. Go to **Settings > Community Nodes**
2. Enter `n8n-nodes-coinbase-cdp`
3. Click **Install**

### Manual Installation

```bash
cd ~/.n8n/custom
npm install n8n-nodes-coinbase-cdp
```

Restart n8n after installation.

## Credentials

You need a **Coinbase CDP API key** from the [Coinbase Developer Portal](https://portal.cdp.coinbase.com/).

| Field | Required | Description |
|-------|----------|-------------|
| API Key ID | Yes | Your CDP API Key ID (UUID format) |
| API Key Secret | Yes | Your CDP API Key Secret (base64-encoded ES256 private key) |
| Wallet Secret | No | Required for signing transactions (transfers, swaps). Leave empty for read-only operations. |

### Getting Your Credentials

1. Go to [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/)
2. Create a new project (or use an existing one)
3. Navigate to **API Keys** and create a new key
4. Copy the **API Key ID** and **API Key Secret**
5. For transaction signing, also copy the **Wallet Secret** from the key creation screen

> **Note**: The Wallet Secret is only shown once during key creation. If you lose it, you'll need to create a new API key.

## Coinbase CDP Node

The action node for deterministic blockchain operations. Supports `usableAsTool: true`, so it can also be used as an AI Agent tool directly.

### Resources & Operations

#### EVM Account

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **Get or Create** | Get an existing account by name or create a new one | `accountName` |
| **List Balances** | List all token balances for an address | `address`, `network` |
| **Request Faucet** | Request testnet tokens | `address`, `faucetNetwork`, `faucetToken` |

#### Solana Account

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **Get or Create** | Get or create a Solana account by name | `accountName` |
| **Request Faucet** | Request Solana devnet tokens | `address`, `faucetToken` |

#### Smart Account

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **Get or Create** | Create an ERC-4337 smart account with an owner | `ownerAccountName`, `smartAccountName` |

#### Transfer

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **Send Native Token** | Transfer ETH, MATIC, AVAX, etc. | `accountName`, `to`, `amount`, `network` |
| **Send ERC-20 Token** | Transfer USDC, DAI, or any ERC-20 | `accountName`, `to`, `amount`, `token`, `network` |

#### Swap

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **Execute Swap** | Swap tokens (Base & Ethereum) | `accountName`, `fromToken`, `toToken`, `fromAmount`, `network` |
| **Get Quote** | Get a swap quote without executing | `accountName`, `fromToken`, `toToken`, `fromAmount`, `network` |

#### Policy

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **List** | List all policies | — |
| **Get** | Get a policy by ID | `policyId` |
| **Create** | Create a new policy | `policyJson` |
| **Update** | Update a policy | `policyId`, `policyJson` |
| **Delete** | Delete a policy | `policyId` |

#### Balance

| Operation | Description | Parameters |
|-----------|-------------|------------|
| **List Token Balances** | List all token balances for an address | `address`, `network` |

### Supported Networks

| Network | Value | Swaps | Faucet |
|---------|-------|-------|--------|
| Base | `base` | Yes | — |
| Base Sepolia | `base-sepolia` | Yes | Yes |
| Ethereum | `ethereum` | Yes | — |
| Ethereum Sepolia | `ethereum-sepolia` | Yes | Yes |
| Arbitrum | `arbitrum` | — | — |
| Optimism | `optimism` | — | — |
| Polygon | `polygon` | — | — |
| BNB Chain | `bnb` | — | — |
| Avalanche | `avalanche` | — | — |
| Zora | `zora` | — | — |
| Solana Mainnet | `solana-mainnet` | — | — |
| Solana Devnet | `solana-devnet` | — | Yes |

## Coinbase CDP Tool Node (AI Agent)

Connect blockchain operations to n8n's AI Agent node. Each tool is a LangChain `DynamicStructuredTool` that an LLM can invoke autonomously.

### Available Tools

| Tool | LangChain Name | Description |
|------|---------------|-------------|
| Get Wallet Details | `get_wallet_details` | Get or create an EVM account and return its address |
| Native Transfer | `native_transfer` | Transfer ETH/native tokens to an address |
| ERC-20 Transfer | `erc20_transfer` | Transfer ERC-20 tokens (USDC, DAI, etc.) |
| Get Balance | `get_balance` | Check token balance for any wallet address |
| Swap Tokens | `swap_tokens` | Swap one token for another on Base/Ethereum |
| Get Swap Price | `get_swap_price` | Get price quote without executing a trade |
| Request Faucet | `request_faucet` | Request testnet tokens (ETH, USDC, SOL) |

### AI Agent Setup

```
[Chat Trigger] → [AI Agent] → [Chat Response]
                      │ tools
         ┌────────────┼────────────┐
   [CDP Tool:    [CDP Tool:    [CDP Tool:
    Wallet]       Balance]      Transfer]
```

1. Add a **Chat Trigger** node
2. Add an **AI Agent** node with your preferred LLM (OpenAI, Anthropic, etc.)
3. Add **Coinbase CDP Tool** nodes for each capability you want the agent to have
4. Connect the CDP Tool nodes to the AI Agent's `ai_tool` input
5. The LLM will decide when and how to use each tool based on the conversation

## Coinbase CDP Trigger Node

Polls for balance changes on any EVM address. Fires when any token balance increases, decreases, or a new token appears.

### Configuration

| Parameter | Description |
|-----------|-------------|
| Event | `Balance Changed` — triggers on any token balance change |
| Address | The EVM wallet address to monitor (0x...) |
| Network | Which network to monitor |

### Output

Each trigger event contains:

```json
{
  "address": "0x...",
  "network": "base-sepolia",
  "token": "ETH",
  "previousBalance": "1000000000000000000",
  "currentBalance": "2000000000000000000",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

The trigger stores the last known balances and compares on each poll. The first poll captures a baseline without triggering.

## Example Workflows

Import these from the `examples/` directory:

| File | Description |
|------|-------------|
| `account-and-balance.json` | Create account and check balances |
| `faucet-and-transfer.json` | Request testnet tokens and send ETH |
| `swap-tokens.json` | Get quote, check liquidity, execute swap |
| `ai-agent-blockchain.json` | AI Agent with wallet, balance, transfer, and faucet tools |
| `balance-monitor.json` | Trigger workflow on balance changes with ETH filtering |
| `multi-chain-accounts.json` | Set up EVM + Solana + Smart Account in parallel with faucets |
| `policy-management.json` | Create spending limit policy and list all policies |

## Development

### Prerequisites

- Node.js 22+
- npm

### Setup

```bash
git clone https://github.com/pvdyck/n8n-nodes-coinbase-cdp
cd n8n-nodes-coinbase-cdp
npm install
```

### Development Server

```bash
npm run dev
```

This uses `@n8n/node-cli` to:
- Create a symlink to your project in n8n's custom extensions directory
- Run TypeScript compiler in watch mode
- Start n8n with hot reload enabled

Open `http://localhost:5678` to access the n8n editor with your nodes loaded.

### Build

```bash
npm run build
```

Compiles TypeScript to `dist/` and copies icons and JSON descriptors.

### Test

```bash
npm test                  # Run all tests
npm test -- --coverage    # Run with coverage report
```

116 tests across 8 test suites with 100% code coverage (statements, branches, functions, lines).

### Lint

```bash
npm run lint              # Check for issues
npm run lint:fix          # Auto-fix issues
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your CDP credentials for E2E testing:

```bash
cp .env.example .env
```

```
CDP_API_KEY_ID=your-key-id
CDP_API_KEY_SECRET=your-key-secret
CDP_WALLET_SECRET=your-wallet-secret
```

## Architecture

```
src/
├── credentials/
│   └── CoinbaseCdpApi.credentials.ts    # 3-field credential type
├── nodes/
│   ├── CoinbaseAgentTool/
│   │   ├── CoinbaseAgentTool.node.ts    # AI tool node (supplyData)
│   │   └── actions/                     # 7 LangChain tool builders
│   │       ├── walletDetails.ts
│   │       ├── nativeTransfer.ts
│   │       ├── erc20Transfer.ts
│   │       ├── erc20Balance.ts
│   │       ├── swap.ts
│   │       ├── getSwapPrice.ts
│   │       └── requestFaucet.ts
│   ├── CoinbaseCdp/
│   │   ├── CoinbaseCdp.node.ts          # Action node (execute)
│   │   └── resources/                   # 7 resource handlers
│   │       ├── account.ts
│   │       ├── solanaAccount.ts
│   │       ├── smartAccount.ts
│   │       ├── transfer.ts
│   │       ├── swap.ts
│   │       ├── policy.ts
│   │       └── balance.ts
│   └── CoinbaseTrigger/
│       └── CoinbaseTrigger.node.ts      # Polling trigger
├── shared/
│   ├── cdpClientFactory.ts              # CDP SDK client creation
│   ├── toolFactory.ts                   # DynamicStructuredTool helper
│   ├── networkOptions.ts                # Reusable network dropdowns
│   └── types.ts                         # TypeScript interfaces
└── icons/
    └── coinbase.svg
```

### Design Decisions

- **AgentKit-compatible tools**: Tool names and schemas match Coinbase's AgentKit conventions (`get_wallet_details`, `native_transfer`, etc.) for ecosystem compatibility, without the heavy `@coinbase/agentkit` dependency.
- **`usableAsTool: true`**: The action node doubles as an AI Agent tool, giving three ways to use blockchain operations: direct execution, AI Agent tool via supplyData, and usableAsTool.
- **Shared CDP client factory**: Single function creates `CdpClient` from n8n credentials, used by all three nodes.
- **Error-safe agent tools**: The `toolFactory` wraps every tool function in try/catch, returning error messages as strings instead of throwing — so the LLM can recover gracefully.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@coinbase/cdp-sdk` | Coinbase Developer Platform SDK v2 |
| `@langchain/core` | LangChain `DynamicStructuredTool` for AI Agent integration |
| `zod` | Schema validation for tool inputs |

## License

MIT
