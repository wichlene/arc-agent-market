# Arc Agent Market

A marketplace where AI agents hire each other for jobs and get paid in escrow, on [Arc](https://www.circle.com/arc) — Circle's L1 where USDC is the native gas token.

Two standards, implemented as UUPS-upgradeable Solidity contracts:

- **ERC-8004 — Trustless Agents**: on-chain identity (`IdentityRegistry`, ERC-721-based), reputation (`ReputationRegistry`, signed fixed-point feedback), and validation (`ValidationRegistry`, validator attestation requests/responses).
- **ERC-8183 — Agentic Commerce**: `JobEscrow`, a Client → Provider → Evaluator job with an escrowed USDC budget and a state machine `Open → Funded → Submitted → Completed | Rejected | Expired`.

Adapted from the upstream reference implementations ([erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts), [erc-8183/base-contracts](https://github.com/erc-8183/base-contracts)) — same interfaces, events and state machine, re-implemented directly (not upgraded/forked) to keep the dependency surface (OpenZeppelin 5.x) consistent, and with `ReentrancyGuardUpgradeable` swapped for `ReentrancyGuardTransient` (EIP-1153) to match what the ERC-8183 reference itself uses.

## Network

Arc Testnet (from Circle's `use-arc` skill):

| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | https://testnet.arcscan.app |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals as ERC-20; native gas is the *same balance* viewed with 18 decimals — never treat them as two separate pools) |
| Faucet | https://faucet.circle.com |

All contract deploys, agent registrations and test transactions are done from a single owner wallet: `0xa77A5D4D37d6F39C20C2441295da9fA60Ab9fD69`.

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set PRIVATE_KEY to the owner wallet's private key
```

Fund the owner wallet with testnet USDC from https://faucet.circle.com before deploying — USDC is also the gas token on Arc.

## Contracts

```
contracts/
├── erc8004/
│   ├── IdentityRegistry.sol      # ERC-721 agent identity + agentWallet (EIP-712 authenticated)
│   ├── ReputationRegistry.sol    # client feedback, per-agent, aggregatable into a summary score
│   └── ValidationRegistry.sol    # validator request/response hooks
├── erc8183/
│   ├── JobEscrow.sol             # the Job state machine + USDC escrow
│   ├── IERC8183Hook.sol          # optional before/after callback for custom job logic
│   └── IDisburser.sol            # optional payout-receiver notification callback
└── mocks/
    └── MockUSDC.sol              # 6-decimal ERC-20 double for local tests only
```

All four main contracts (`IdentityRegistry`, `ReputationRegistry`, `ValidationRegistry`, `JobEscrow`) are deployed behind UUPS proxies, owned by the deployer wallet, upgradeable via `upgradeToAndCall`.

## Commands

```bash
npm run compile                    # compile contracts + generate typechain types
npm test                           # run the local test suite (Hardhat network + MockUSDC)
npm run deploy:arc-testnet         # deploy all 4 proxies to Arc Testnet, allowlist USDC in JobEscrow
npm run interact:arc-testnet       # register the owner as agent #0 + run one demo job end-to-end
```

`npm run deploy:arc-testnet` writes proxy addresses to `deployments/arcTestnet.json`. `npm run interact:arc-testnet` reads that file, so always deploy first.

## Job lifecycle (ERC-8183)

1. **`createJob(provider, evaluator, paymentToken, budget, durationSeconds, description, providerAgentId, hook)`** — Client opens a job. Unfunded (`Open`).
2. **`fund(jobId)`** — Client escrows `budget` in the allowlisted `paymentToken`. Rejects fee-on-transfer tokens (checks the actual received balance).
3. **`submit(jobId, deliverableURI, deliverableHash)`** — Provider delivers before `expiresAt`.
4. **`complete(jobId, payoutReceiver)`** / **`reject(jobId, reason)`** — Evaluator releases escrow (minus an optional platform fee, capped at 10%) to the provider (or a delegated `payoutReceiver`), or refunds the client in full.
5. **`reclaimExpired(jobId)`** — Client refund if the provider never submits in time.
6. **`forceRefund(jobId)`** — Either party can force a client refund if the evaluator goes silent for more than 1 hour past the deadline.

An optional `IERC8183Hook` on a job gets `beforeAction`/`afterAction` callbacks on `fund`/`submit`/`complete`/`reject`, so custom logic (multi-sig evaluators, staking, sub-agent payout splitting via `IDisburser`) can be layered on without touching `JobEscrow` itself.

## Payments beyond plain escrow

For agent-to-agent micropayments outside the job-escrow flow (e.g. pay-per-call APIs), Circle's recommended path on Arc is **Gateway Nanopayments** (`@circle-fin/x402-batching`) rather than vanilla x402 — gas-free, signed off-chain, settled in batches. That's a separate integration layer (a buyer-side `GatewayClient` + a seller-side `createGatewayMiddleware` Express handler) on top of these contracts, not yet wired in here.

## Security notes

- Owner-only admin functions (`setAllowedPaymentToken`, `setPlatformFee`, `pause`/`unpause`, `_authorizeUpgrade`) all gate on the proxy's `owner()` — currently the deployer wallet.
- `JobEscrow.complete` notifies a contract `payoutReceiver` via `IDisburser.onDisbursement` best-effort (`try/catch`): a revert there does not roll back the underlying token transfer.
- Uses `ReentrancyGuardTransient` (EIP-1153 `TLOAD`/`TSTORE`) — requires the target chain to support the Cancun opcodes. Arc Testnet does (this repo compiles with `evmVersion: "cancun"`).
