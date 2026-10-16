# Why Paytag stores a Solana address as 32 raw bytes on Base

*Design notes on a cross-chain name registry: what it stores, what it refuses, and two holes in my first immutable contracts that I'd papered over off-chain before fixing them where they belonged. Claims about the code link to the lines that back them.*

[Paytag](https://www.paytag.dev) maps one name, like `@derrick`, to a person's addresses on Ethereum, Base, Solana and Bitcoin. The registry is two small, immutable, admin-free contracts on Base, live on Base Sepolia. An indexer serves them over HTTP, and an [npm SDK](https://www.npmjs.com/package/@paytagdev/sdk) resolves a name in one call.

## The character that JavaScript turns into a `k`

`"\u212A".toLowerCase()` is `"k"`. U+212A is the KELVIN SIGN. It looks like a capital K, and JavaScript's Unicode-aware lowercasing folds it into plain ASCII.

Paytag's off-chain API normalized usernames with exactly that call, `username.trim().toLowerCase()`, from the first commit until a review caught it ([fix](https://github.com/ansah25/paytag/commit/3e558abd469815fd43e0b4637f8ecced1cef525d)). So `\u212Aate` became `kate`, passed the `[a-z0-9_]` check, and was treated as `kate`.

**It wasn't exploitable.** Folding always produced the ASCII name, and uniqueness is enforced on the normalized form, so a Kelvin-sign link resolved to whoever owns `kate` and could never create a second one.

**The contract held.** The on-chain registry rejects every byte at or above `0x80` ([`NonAsciiName`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L237)), so it refused the same input outright. The failure was a disagreement between layers, not a collision.

That is the argument for checking names in two independent places: the stricter one caught the looser one's mistake. The API now [transforms only ASCII](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/src/services/userService.ts#L66), so both reject a non-ASCII byte. The rest of this post is about designing that kind of agreement in, and about two places where my first contracts relied on a layer above them instead.

## The defaults, briefly

Ownership lives in exactly one place, the registry on Base. Solana, Bitcoin and other EVM chains are *records* on the name, never parallel registries. Per-chain registries split ownership with nothing keeping the copies agreeing; a bridge to sync them is a security surface out of proportion to the problem. ENS subnames (`derrick.paytag.eth`) mean mainnet registration or an off-chain or L2 resolver behind CCIP-Read, as Basenames does. Both are reasonable designs, but they'd add a gateway or mainnet dependency, a nested namespace and ENS's normalization rules to a flat payments handle that needs none of them.

Records are keyed by coin type: [ENSIP-9](https://docs.ens.domains/ensip/9)'s 60 for ETH and 0 for BTC, SLIP-44's 501 for SOL, and [ENSIP-11](https://docs.ens.domains/ensip/11)'s `0x80000000 | chainId` for other EVM chains, so Base is 2147492101. A new chain needs no contract change. The values are raw bytes: 20 address bytes for EVM chains, a Bitcoin output's `scriptPubKey`, and for Solana the **32-byte address** itself (for a wallet, its ed25519 public key) rather than its base58 string, following ENS's address-encoder convention. Raw bytes give one encoding per address, with no checksum casings or base58 variants, and keep the contract chain-agnostic. Decoding lives in [one shared codec](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/indexer/src/lib/codec.ts#L34), drift-checked in CI against shared test vectors.

Because the fixes below live in the contract, any off-chain reader with a Base RPC can resolve a name by calling `addr()` directly and get only what the current owner set. (A contract on another chain can't read Base at all without a bridge or proofs; that's outside this design.) In v0.1 a direct read wasn't safe, which is the subject of the centerpiece section.

## Normalization that rejects instead of transforming

A name's identity is `keccak256(normalize(name))`, so the namespace's safety reduces to one function, [`_normalizeInPlace`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L230):

```solidity
uint8 c = uint8(b[i]);
if (c >= 0x80) revert NonAsciiName(i);

if (uint8(c - 0x41) < 26) {
    b[i] = bytes1(c + 32); // A-Z -> a-z
} else if (!(uint8(c - 0x61) < 26 || uint8(c - 0x30) < 10 || c == 0x5f)) {
    revert InvalidCharacter(i, bytes1(c));
}
```

There's exactly one transformation, ASCII uppercase to lowercase, a bijection on the characters it touches. Nothing is dropped, substituted or folded; every other byte passes through or reverts with its position. So normalization is idempotent, and two inputs map to the same name only if they differ by ASCII case.

Both properties are tested rather than asserted: [`testFuzz_normalizeIsIdempotent`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/PaytagRegistry.t.sol#L519), and [`testFuzz_normalizeMatchesReference`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/PaytagRegistry.t.sol#L541), which runs the contract against an independent reference model over arbitrary bytes, revert reason included. A stateful invariant, [`invariant_noNameCollisions`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/invariant/PaytagInvariants.t.sol#L95), checks that no two registrations share a node.

**What I rejected was Unicode.** [UTS-46](https://www.unicode.org/reports/tr46/) and [ENSIP-15](https://docs.ens.domains/ensip/15) exist because real names are international, but they're large, versioned tables that keep changing. In an immutable contract a normalization bug is permanent, and the Kelvin sign slipped through a one-line function in a language with excellent Unicode support. Rejecting everything above `0x80` removes Cyrillic `а`, zero-width joiners and their relatives in one comparison. ASCII look-alikes (`0`/`o`, `1`/`l`) remain; the app shows names in a monospace font, where they're distinct. The cost is real: Paytag can't register `@josé`.

## Two holes, and why the fix had to be on-chain

v0.1 shipped with two known problems around transfers, both handled in the indexer rather than the contract.

**Wrong payee.** Transferring a name moved ownership, but the previous owner's records stayed in the resolver. A plain `addr()` call right after a transfer returned the previous owner's address with nothing to say so. On a payments product, that's money sent to the wrong person.

**Wrong identity.** A previous owner's primary name kept resolving: `reverse(oldOwner)` still returned the name, because the ETH record still pointed at them.

v0.1's answer was the indexer. It replayed events, flagged records written before the latest transfer as stale, kept them out of the addresses a payment flow used, and ignored reverse claims resting on them. Writing an earlier draft of this post, I described that design as "the supported read path", and had to admit what it meant: it protected everyone reading through the indexer, and nobody else. An invariant enforced only off-chain is an invariant direct readers don't get, and an immutable contract has no upgrade path to add it later. So the fix had to be a new contract.

v0.2 gives every name an **epoch**, stored in the [same slot as its owner](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L41). A [transfer](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L143) to a different owner increments it, in the same `SSTORE` that changes the owner, so a transfer costs about what it did. The resolver keys every record by `(name, epoch)` and [reads the current epoch](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagResolver.sol#L78), so the moment a name moves, every record the previous owner wrote becomes unreachable through `addr()`, for every reader, with no cleanup. (The old values still exist in storage and in past events, like everything on a chain; they're just never served.) [`reverse()`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagResolver.sol#L101) accepts a claim only while the current epoch's ETH record points back at the account, so the old owner's primary name goes dark at the same moment. It would only come back if the new owner deliberately pointed the ETH record at the old owner, which is forward verification working as intended.

The tests pin it down: [records clear on transfer](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/PaytagResolver.t.sol#L190), the [old primary name goes dark](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/PaytagResolver.t.sol#L365), and the invariant suite's ghost model gained epochs, so [every record served must be the current owner's latest write in the current epoch](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/invariant/PaytagInvariants.t.sol#L64).

There are honest costs. `addr()`, `reverse()` and `setReverse()` now call the registry, about 5.4k extra gas each inside a transaction (free off-chain). And a name transferred away and back (A → B → A) comes home empty, so the app shows it as *Unconfigured* and the indexer reports `recordsReset`, rather than letting it quietly resolve to nothing.

## Commit-reveal, and the bug in my first version

v0.1 registered a name in one transaction, so whoever saw that transaction before it was mined could see the name before it was claimed. On Base there's no public mempool, so in practice that's the sequencer and the user's RPC provider, not the whole world, but it's still a window worth closing. v0.2 registers in two: [`commit(hash)`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L86), then [`register(name, secret)`](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L113) between 15 seconds and 24 hours later.

What that buys is that **the name isn't legible before the transaction that claims it**: the commitment is an opaque hash, and the name first appears in the reveal, which registers it in the same transaction. The minimum age exists so commit and reveal can't land in the same block, which would collapse the scheme; with 2-second blocks, a reveal lands at least eight blocks after its commit (the deployment's first registration took eleven). A competitor who sees a reveal pending would need their own commitment to that name, already 15 seconds old, so [a pending reveal can't be raced](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/PaytagRegistry.t.sol#L412). It doesn't stop someone who committed to the same name first; that's first-come-first-served working.

My first draft stored commitments in a single `mapping(bytes32 => uint256)`, and `commit` overwrote whatever was there. An independent review, run before deployment, pointed out that a commitment hash is public the moment it's on-chain: anyone could re-commit a victim's hash to restart their clock, keep their reveal reverting as too new, and read the name and secret out of the reverted reveal. v0.2 stores commitments [per committer](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/src/PaytagRegistry.sol#L49), so nobody can touch anyone else's ([test](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/PaytagRegistry.t.sol#L371)), and every [invariant-suite registration has a griefer re-commit the public hash](https://github.com/ansah25/paytag/blob/8e689f7872376397eb1c273614b38faf50763227/contracts/test/invariant/Handler.sol#L96) just before it matures. Putting the old shared map back as a planted bug fails both.

What's left is first-come squatting: anyone can claim any free name for the gas of a commit and a register, a fraction of a cent on an L2. On a testnet that's fine; a mainnet deployment would want pricing or expiry.

## Reorgs

Some guarantees live in the indexer, so it matters what happens when the chain rewinds. It's built on [Ponder](https://ponder.sh), which journals every row change for blocks inside a 180-second reorg window. On a reorg it reverts the affected rows to the common ancestor and re-indexes the canonical blocks: a registration the new chain re-includes reappears, one it drops disappears. The 180 seconds is Ponder's heuristic, about 90 Base blocks, not Base's finalized head; a reorg deeper than that makes Ponder stop rather than serve state it can't vouch for. That fails closed, which is the right direction for a read model. The app's "Done" means *indexed*, not *finalized*; a flow that moves real value should wait for finality, or at least re-resolve before sending.

## What I'd still change

- **Registration pricing or expiry** before any mainnet deployment, to make squatting cost something.
- **International names.** ASCII-only is a deliberate trade, but it's a trade.
- **Proofs from the indexer.** Its responses carry none, so readers who use it trust its operator. It's open source and rebuilds from chain events, so anyone can run their own, and direct `addr()` reads are now safe on their own.

## Takeaways

- **Canonical ownership, encoded records.** One registry owns the name; every chain is a coin-type key with raw bytes, decoded by one shared, tested module.
- **Normalize by rejecting.** Allow one transformation you can prove safe, and revert on everything else.
- **Invariants belong in the contract when the contract is immutable.** A rule enforced only in a read layer protects only that read layer's readers.
- **Have someone else attack it before it's permanent.** The griefing bug was a small fix before deployment, and would have cost a redeploy after.

The code is at [github.com/ansah25/paytag](https://github.com/ansah25/paytag): contracts at 100% line, statement, branch and function coverage with six stateful invariants ([details](https://github.com/ansah25/paytag#tests-coverage-gas)), live and verified on Base Sepolia ([registry](https://sepolia.basescan.org/address/0x351fed5e079C421493A485C1b90Cc115394C5cb7#code), [resolver](https://sepolia.basescan.org/address/0x0b8BC41A7CE8cD5ACD21e62A5bE40AC281627f66#code)). Try a name without a wallet at [paytag.dev/on-chain/derrick](https://www.paytag.dev/on-chain/derrick).
