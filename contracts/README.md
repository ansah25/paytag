# Paytag Contracts

Solidity registry and resolver for Paytag names, deployed on Base. Built with [Foundry](https://getfoundry.sh).

| Contract | Role |
|---|---|
| [`PaytagRegistry`](src/PaytagRegistry.sol) | Name normalization, registration, ownership, transfer |
| [`PaytagResolver`](src/PaytagResolver.sol) | Per-chain address records (ENSIP-9 coin types), forward-verified reverse resolution |

## Local setup

```bash
git submodule update --init --recursive
cd contracts
forge test
```

## Commands

```bash
forge build --sizes      # compile + bytecode sizes
forge test -vvv          # unit / fuzz / invariant suites
forge fmt                # format
forge coverage           # coverage report
forge snapshot           # gas snapshot -> .gas-snapshot
```

## Deploy

Set these in `contracts/.env` (gitignored), then `source .env`:

| Variable | Purpose |
|---|---|
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC endpoint |
| `ETHERSCAN_API_KEY` | Etherscan v2 key (covers Basescan) for verification |
| `DEPLOYER_PRIVATE_KEY` | Funded deployer key — testnet only, never commit |

```bash
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```
