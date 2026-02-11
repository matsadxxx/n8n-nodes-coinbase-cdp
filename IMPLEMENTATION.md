# Implementation Architecture

> Detailed architecture diagrams and implementation details for [`n8n-nodes-coinbase-cdp-agentkit`](https://www.npmjs.com/package/n8n-nodes-coinbase-cdp-agentkit). For installation and usage, see [README.md](README.md).

---

## Table of Contents

- [Package Architecture](#package-architecture)
- [Data Flow](#data-flow)
- [Source File Map](#source-file-map)
- [Credential Flow](#credential-flow)
- [Action Node Router](#action-node-router)
- [AI Agent Workflow](#ai-agent-workflow)
- [Tool Creation Flow](#tool-creation-flow)
- [Trigger Polling Mechanism](#trigger-polling-mechanism)
- [Triple-Pathway Usage](#triple-pathway-usage)
- [Example Workflow Diagrams](#example-workflow-diagrams)

---

## Package Architecture

AgentKit-first architecture: 3 focused nodes + 1 shared credential, designed to align with [Coinbase AgentKit](https://docs.cdp.coinbase.com/agent-kit/welcome) conventions while keeping the bundle lightweight by using [`@coinbase/cdp-sdk`](https://github.com/coinbase/cdp-sdk) directly.

```mermaid
graph TB
    subgraph Package["n8n-nodes-coinbase-cdp-agentkit"]
        subgraph Credential["CoinbaseCdpApi Credential"]
            AK["API Key ID"]
            AS["API Secret"]
            WS["Wallet Secret<br/><i>(optional)</i>"]
        end

        Credential -->|shared auth| AT["CoinbaseAgentTool<br/><b>AI Tool Node</b><br/>supplyData → 7 tools"]
        Credential -->|shared auth| CD["CoinbaseCdp<br/><b>Action Node</b><br/>execute → 7 resources"]
        Credential -->|shared auth| CT["CoinbaseTrigger<br/><b>Polling Trigger</b><br/>poll → balance changes"]

        subgraph Shared["Shared Layer"]
            CF["cdpClientFactory"]
            NO["networkOptions"]
            TF["toolFactory"]
            TY["types"]
        end

        AT --> Shared
        CD --> Shared
        CT --> Shared
    end

    Shared -->|initializes| SDK["@coinbase/cdp-sdk"]
    AT -->|creates| LC["DynamicStructuredTool<br/><i>@langchain/core</i>"]
    TF -->|validates with| ZD["Zod Schemas"]
```

---

## Data Flow

How data flows between triggers, nodes, and AI agents:

```mermaid
flowchart LR
    subgraph Inputs
        MT["Manual Trigger"]
        CH["Chat Trigger"]
        SC["Schedule / Cron"]
    end

    subgraph Processing
        AI["AI Agent<br/><i>Claude / GPT</i>"]
        CDP["Coinbase CDP<br/><i>Action Node</i>"]
        TRG["Coinbase Trigger<br/><i>Balance Monitor</i>"]
    end

    subgraph Tools["AI Tools (supplyData)"]
        T1["Wallet Details"]
        T2["Native Transfer"]
        T3["ERC-20 Transfer"]
        T4["Get Balance"]
        T5["Swap Tokens"]
        T6["Get Swap Price"]
        T7["Request Faucet"]
    end

    MT --> CDP
    CH --> AI
    SC --> TRG

    AI -.->|tool calls| T1 & T2 & T3 & T4 & T5 & T6 & T7
    T1 & T2 & T3 & T4 & T5 & T6 & T7 -.->|results| AI

    CDP --> |json output| Next["Next Node"]
    AI --> |chat response| Resp["Chat Response"]
    TRG --> |balance change event| Alert["Alert / Notification"]
```

---

## Source File Map

```mermaid
graph TD
    subgraph src["src/"]
        subgraph cred["credentials/"]
            C1["CoinbaseCdpApi.credentials.ts<br/><i>3-field credential type</i>"]
        end
        subgraph icons["icons/"]
            I1["coinbase.svg"]
        end
        subgraph nodes["nodes/"]
            subgraph agent["CoinbaseAgentTool/"]
                A1["CoinbaseAgentTool.node.ts<br/><i>supplyData method</i>"]
                A2["CoinbaseAgentTool.node.json<br/><i>AI codex metadata</i>"]
                subgraph actions["actions/"]
                    AA1["walletDetails.ts"]
                    AA2["nativeTransfer.ts"]
                    AA3["erc20Transfer.ts"]
                    AA4["erc20Balance.ts"]
                    AA5["swap.ts"]
                    AA6["getSwapPrice.ts"]
                    AA7["requestFaucet.ts"]
                end
            end
            subgraph cdp["CoinbaseCdp/"]
                B1["CoinbaseCdp.node.ts<br/><i>execute method, usableAsTool</i>"]
                B2["CoinbaseCdp.node.json"]
                subgraph resources["resources/"]
                    R1["account.ts"]
                    R2["solanaAccount.ts"]
                    R3["smartAccount.ts"]
                    R4["transfer.ts"]
                    R5["swap.ts"]
                    R6["policy.ts"]
                    R7["balance.ts"]
                end
            end
            subgraph trigger["CoinbaseTrigger/"]
                D1["CoinbaseTrigger.node.ts<br/><i>poll method</i>"]
                D2["CoinbaseTrigger.node.json"]
            end
        end
        subgraph shared["shared/"]
            S1["cdpClientFactory.ts"]
            S2["networkOptions.ts"]
            S3["toolFactory.ts"]
            S4["types.ts"]
        end
    end
```

---

## Credential Flow

```mermaid
sequenceDiagram
    participant User
    participant Portal as CDP Portal
    participant n8n
    participant SDK as CDP SDK

    User->>Portal: Create API Key
    Portal-->>User: API Key ID + Secret + Wallet Secret
    User->>n8n: Configure CoinbaseCdpApi credential
    n8n->>SDK: CdpClient({ apiKeyId, apiKeySecret, walletSecret })
    SDK-->>n8n: Authenticated client
    n8n->>SDK: Execute blockchain operations
    SDK-->>n8n: Results
```

---

## Action Node Router

The `CoinbaseCdp` action node routes input items through a resource/operation pattern:

```mermaid
flowchart LR
    Input["Input Items"] --> Execute["execute()"]

    Execute --> Router{Resource?}
    Router -->|account| ACC["Account Ops"]
    Router -->|solanaAccount| SOL["Solana Ops"]
    Router -->|smartAccount| SMA["Smart Account"]
    Router -->|transfer| TRN["Transfer Ops"]
    Router -->|swap| SWP["Swap Ops"]
    Router -->|policy| POL["Policy CRUD"]
    Router -->|balance| BAL["Balance Query"]

    ACC & SOL & SMA & TRN & SWP & POL & BAL --> SDK["CDP SDK"]
    SDK --> Output["Output Items"]
```

---

## AI Agent Workflow

The `CoinbaseAgentTool` node connects blockchain operations to n8n's AI Agent via LangChain `DynamicStructuredTool`:

```mermaid
flowchart TB
    Chat["Chat Trigger<br/><i>User message</i>"] --> Agent["AI Agent<br/><i>Claude / GPT / Gemini</i>"]
    Agent --> Response["Chat Response"]

    Agent -.->|"tool call"| T1["CDP Tool:<br/>Wallet Details"]
    Agent -.->|"tool call"| T2["CDP Tool:<br/>Native Transfer"]
    Agent -.->|"tool call"| T3["CDP Tool:<br/>ERC-20 Transfer"]
    Agent -.->|"tool call"| T4["CDP Tool:<br/>Get Balance"]
    Agent -.->|"tool call"| T5["CDP Tool:<br/>Swap Tokens"]
    Agent -.->|"tool call"| T6["CDP Tool:<br/>Get Swap Price"]
    Agent -.->|"tool call"| T7["CDP Tool:<br/>Request Faucet"]

    T1 -.->|"result"| Agent
    T2 -.->|"result"| Agent
    T3 -.->|"result"| Agent
    T4 -.->|"result"| Agent
    T5 -.->|"result"| Agent
    T6 -.->|"result"| Agent
    T7 -.->|"result"| Agent
```

---

## Tool Creation Flow

How each AI tool is created and later invoked by the LLM:

```mermaid
sequenceDiagram
    participant n8n as n8n AI Agent
    participant Node as CoinbaseAgentTool
    participant TF as toolFactory
    participant LC as DynamicStructuredTool
    participant SDK as CDP SDK

    n8n->>Node: supplyData(itemIndex)
    Node->>Node: getNodeParameter('tool')
    Node->>Node: getCdpClient(credentials)
    Node->>TF: createAgentTool({ name, schema, func })
    TF->>LC: new DynamicStructuredTool({ name, schema, func })
    TF-->>Node: tool instance
    Node-->>n8n: { response: tool }

    Note over n8n,SDK: Later, when LLM decides to call the tool:
    n8n->>LC: invoke({ param1, param2 })
    LC->>SDK: CDP API call
    SDK-->>LC: result
    LC-->>n8n: JSON string (or error string)
```

---

## Trigger Polling Mechanism

The `CoinbaseTrigger` uses n8n's polling mechanism with `staticData` persistence:

```mermaid
stateDiagram-v2
    [*] --> FirstPoll: n8n scheduler triggers

    FirstPoll --> StoreBaseline: Fetch balances from CDP SDK
    StoreBaseline --> WaitForNext: Store in staticData, return null

    WaitForNext --> SubsequentPoll: n8n scheduler triggers

    SubsequentPoll --> FetchCurrent: Fetch balances from CDP SDK
    FetchCurrent --> Compare: Load previous from staticData

    Compare --> NoChange: Balances identical
    Compare --> Changed: Differences found

    NoChange --> UpdateState: Update staticData
    UpdateState --> WaitForNext: Return null (no trigger)

    Changed --> EmitEvents: Build change events
    EmitEvents --> UpdateState2: Update staticData
    UpdateState2 --> WaitForNext: Return events (trigger fires)
```

---

## Triple-Pathway Usage

The `CoinbaseCdp` action node sets `usableAsTool: true`, enabling three usage modes:

```mermaid
flowchart TB
    Node["CoinbaseCdp Node"]

    Node -->|"1. Direct"| D["Trigger → CoinbaseCdp → Next Node<br/><i>Resource/operation UI</i>"]
    Node -->|"2. AI Tool"| A["AI Agent ─ tools ─► CoinbaseCdp<br/><i>LLM selects operation</i>"]
    Node -->|"3. Expression"| E["$('CoinbaseCdp').item.json.address<br/><i>Reference in other nodes</i>"]
```

---

## Example Workflow Diagrams

### 1. Account & Balance Check

```mermaid
flowchart LR
    A["Manual Trigger"] --> B["Get/Create Account<br/><i>account.getOrCreate</i>"]
    B --> C["Check Balance<br/><i>balance.listTokens</i>"]
```

Create an EVM account on Base Sepolia and query its token balances.

### 2. Faucet & Transfer

```mermaid
flowchart LR
    A["Manual Trigger"] --> B["Create Sender<br/><i>account.getOrCreate</i>"]
    B --> C["Request Faucet ETH<br/><i>account.requestFaucet</i>"]
    C --> D["Check Balance<br/><i>balance.listTokens</i>"]
```

Request testnet ETH from the faucet and verify receipt.

### 3. Swap Tokens

```mermaid
flowchart LR
    A["Manual Trigger"] --> B["Get Account"]
    B --> C["Get Swap Quote<br/><i>WETH → USDC</i>"]
    C --> D{"Liquidity<br/>Available?"}
    D -->|Yes| E["Execute Swap"]
    D -->|No| F["Stop"]
```

Quote a WETH→USDC swap on Base, check liquidity, execute if available.

### 4. AI Agent Blockchain

```mermaid
flowchart TB
    A["Chat Trigger"] --> B["AI Agent<br/><i>Claude / GPT</i>"]
    B --> C["Chat Response"]
    B -.->|tools| D["Wallet Details"]
    B -.->|tools| E["Get Balance"]
    B -.->|tools| F["Native Transfer"]
    B -.->|tools| G["Request Faucet"]
```

Chat-driven blockchain operations via LLM tool calling.

### 5. Balance Monitor

```mermaid
flowchart LR
    A["CoinbaseTrigger<br/><i>polls every 5min</i>"] --> B{"Is ETH?"}
    B -->|Yes| C["Format Alert"]
    C --> D["Send Notification<br/><i>Slack / Email</i>"]
    B -->|No| E["Skip"]
```

Event-driven balance monitoring with configurable alerts.

### 6. Multi-Chain Accounts

```mermaid
flowchart TB
    A["Manual Trigger"] --> B["EVM Account<br/><i>base-sepolia</i>"]
    A --> C["Solana Account<br/><i>solana-devnet</i>"]
    B --> D["EVM Faucet"]
    C --> E["Solana Faucet"]
    E --> F["Smart Account<br/><i>ERC-4337</i>"]
```

Parallel account creation across EVM and Solana with testnet funding.

### 7. Policy Management

```mermaid
flowchart LR
    A["Manual Trigger"] --> B["List All Policies<br/><i>policy.list</i>"]
```

Query CDP governance policies for the organization.
