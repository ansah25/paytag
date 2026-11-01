# Web dependency advisories

`npm audit --omit=dev` at the repo root reports **35 vulnerable packages (21 high, 14 moderate)**, all in the `web` workspace. This file explains why none of them can be reached in what Paytag ships, how that was checked, and what would make each answer wrong.

## Scope of this analysis

- **Checked:** 2026-11-01, on the lockfile in the same commit as this file (`git log -1 -- web/DEPENDENCY_ADVISORIES.md`), branched from `main` at `ff17980`.
- **Versions:** `next@15.5.28`, `wagmi@2.19.5` (+ `@wagmi/core@2.22.1`), `@solana/web3.js@1.99.0`, `sats-connect@4.2.1` (with `@sats-connect/core@0.10.0`), `valibot@1.5.0`.
- **Call sites checked** (each conclusion depends on these and nothing else):
  - EVM: `lib/wagmi.ts` builds the only wagmi config, with one connector, `injected()` from `@wagmi/core`.
  - Bitcoin: `lib/bitcoin.ts` calls `request('getAccounts')` and `request('sendTransfer')`. `lib/pay/useBitcoinPay.ts` calls `getDefaultProvider()` and `getProviders()`. Nothing else from sats-connect is used.
  - Solana: `lib/solana.ts` and `lib/pay/useSolanaPay.ts`, both only in the browser (`next/dynamic`, `ssr: false`).

Any change to those call sites voids the matching section below. [When to revisit](#when-to-revisit) lists the specific triggers.

`npm audit fix --force` isn't the answer: it would install `wagmi@3.7.9`, downgrade `sats-connect` to 2.1.0, move `@solana/web3.js` to 3.x (a different API) and install `next@16`, all major changes.

## Reading the count

`npm audit` counts packages, not advisories. If a package depends on a flagged package, it gets flagged too. Of the 35, only **7 carry advisories of their own**: `axios`, `decode-uri-component`, `postcss`, `stream-json`, `uuid`, `ws` and `zod`. The other 28 are only flagged because of what they depend on: `wagmi`, `@reown/appkit`, `sats-connect` and the rest. So the useful question for each of those 7 is whether its vulnerable code runs, and on what input.

No path runs through the API or the SDK. Every vulnerable package is installed by `paytag-web`.

| Group | Packages | Why it can't be reached |
|---|---|---|
| [1. Wallet connector tree](#1-wallet-connector-tree-26-packages) | 26 | Installed by wagmi but never imported, so never bundled. Enforced by lint. |
| [2. Bitcoin (sats-connect)](#2-bitcoin-sats-connect-3-packages) | 3 | Bundled, but axios only runs for Runes calls, which Paytag never makes |
| [3. Solana client](#3-solana-client-4-packages) | 4 | The browser build loads only jayson's browser client; the flagged code is Node-only or not called |
| [4. Next.js build tooling](#4-nextjs-build-tooling-2-packages) | 2 | postcss runs at build time, on our own CSS |

## 1. Wallet connector tree (26 packages)

wagmi 2 declares `@wagmi/connectors` as a hard dependency. Installing wagmi therefore installs every wallet SDK it can talk to: WalletConnect/Reown, Coinbase (`@base-org/account` → `@coinbase/cdp-sdk`), MetaMask SDK, Gemini, Porto.

Paytag uses one connector, `injected()`, which talks to the extension's `window.ethereum` through EIP-6963. It imports it from `@wagmi/core`, not from the `wagmi/connectors` barrel. Nothing imports from `@wagmi/connectors`, so webpack never pulls the tree in.

**Packages:** `wagmi`, `@wagmi/connectors`, `@coinbase/cdp-sdk`, `@gemini-wallet/core`, `@metamask/rpc-errors`, `@metamask/sdk`, `@metamask/sdk-communication-layer`, `@metamask/utils`, `@reown/appkit`, `@reown/appkit-controllers`, `@reown/appkit-pay`, `@reown/appkit-scaffold-ui`, `@reown/appkit-ui`, `@reown/appkit-utils`, `@reown/appkit-wallet`, `@walletconnect/core`, `@walletconnect/ethereum-provider`, `@walletconnect/sign-client`, `@walletconnect/universal-provider`, `@walletconnect/utils`, `abitype`\*, `viem`\*, `query-string`, `decode-uri-component`, `ws`\*, `zod`\*.

\* Only the copies nested inside the connector tree are flagged. The app's own copies are fine: `viem@2.57.10`, `ws@8.21.0`, `abitype@1.2.3`, and `zod@4.6.7` (shared with the API).

The tree also holds the second copy of `axios` (1.16.0, under `@coinbase/cdp-sdk`: 20 advisories, 6 high) and the MetaMask copies of `uuid`. Both packages are counted once, in groups 2 and 3, where their bundled copies are discussed.

Packages in this group with their own advisories:

| Package | Advisories | Installed by |
|---|---|---|
| `ws` (nested 8.x) | GHSA-58qx-3vcg-4xpx (memory disclosure), GHSA-96hv-2xvq-fx4p (fragment DoS) | `@walletconnect/utils`, `@reown/*` |
| `zod` (nested 3.x) | GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized collections) | `@coinbase/cdp-sdk`, `@reown/appkit-wallet` |
| `decode-uri-component@0.2.2` | GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f (DoS from malformed percent-encoding) | `query-string` ← `@walletconnect/utils` |

None of these copies is bundled. The app's viem uses `ws@8.21.0` (fixed), and only on Node; in the browser `isows` uses the native `WebSocket`, and Paytag only uses HTTP transports.

**Evidence.** A production `next build` was searched for strings each SDK embeds at runtime. These survive minification because they are URLs and protocol constants, not module names.

| Search string | Belongs to | Client chunks | Server bundles |
|---|---|---|---|
| `relay.walletconnect`, `walletconnect` | WalletConnect | 0 | 0 |
| `@reown`, `appkit` | Reown AppKit | 0 | 0 |
| `api.cdp.coinbase.com`, `cdp-sdk` | Coinbase CDP | 0 | 0 |
| `metamask-sdk`, `MetaMask SDK` | MetaMask SDK | 0 | 0 |
| `keys.gemini.com` | Gemini | 0 | 0 |
| `porto` | Porto | 0 | 0 |

Positive controls, to show the search finds code that is there: `eip6963:requestProvider` and `personal_sign` (wagmi `injected()` + SIWE) are found in client chunks, and `XverseProviders` in the Bitcoin chunk.

**The guard.** This holds only while nobody imports the tree. `web/.eslintrc.json` rejects `wagmi/connectors`, `@wagmi/connectors`, `@walletconnect/*`, `@reown/*`, `@coinbase/*`, `@base-org/*`, `@metamask/*`, `@gemini-wallet/*` and `porto` in three forms: static `import`/`export … from` (`no-restricted-imports`), dynamic `import()` and `require()` (`no-restricted-syntax`). Lazy loading is included because a lazy chunk is still shipped. The lint script runs on the whole of `web/` (`next lint --dir .`), and CI runs it. A wallet SDK that arrives some other way, for example a new dependency that bundles one internally, would not be caught; that is what re-running the bundle check below is for.

## 2. Bitcoin (sats-connect, 3 packages)

**Packages:** `sats-connect`, `@sats-connect/core`, `axios`.

sats-connect **is** bundled. The Bitcoin pay flow loads it as a lazy chunk (`components/pay/BitcoinPayFlow` via `next/dynamic`), and it handles replies from a wallet extension, which is only partly trusted. So this group needs the closest look.

`sats-connect@4.2.1` pins `@sats-connect/core@0.10.0`, which pins `axios@1.12.0`. **32 axios advisories (11 high)** apply to that version: proxy/NO_PROXY bypasses, prototype-pollution gadgets, request/response size limits, and others. Some of them (the fetch adapter and the pollution gadgets) would apply in a browser, so "axios is Node-only" is **not** the reason they are unreachable.

The reason is that **axios never makes a request on Paytag's paths.**
- In core 0.10.0, axios is used only by `RunesApi` (Runes mint/etch/order calls against `ordinals.xverse.app`).
- `RunesApi` is constructed only by the `runes_*` cases of `SatsConnectAdapter.request`, and the adapters (`XverseAdapter`, `UnisatAdapter`, `FordefiAdapter`, `BaseAdapter`) are used only by sats-connect's `Wallet` default export. Paytag doesn't use that export.
- Paytag's `request('getAccounts')` and `request('sendTransfer')` are core's top-level `request`. It calls `window.XverseProviders.BitcoinProvider.request` directly (falling back to `window.BitcoinProvider`), with no adapter and no `RunesApi`.
- `getProviders()` returns `window.btc_providers`, and `getDefaultProvider()` reads `localStorage['sats-connect_defaultProvider']`. Neither touches axios.
- The prototype-pollution gadgets would also need a separate pollution bug to start from, and they only fire when axios builds a request.

**This holds only while** Paytag makes no sats-connect call other than those four. Any `runes_*` method, `wallet_connect`, `signPsbt` or another new call needs this section redone first.

**valibot** (`1.5.0` via an override; it was `1.1.0`) is the only other validation code that sees wallet data. Core 0.10.0 checks each wallet reply in `requestInternal` with `v.is()` against the JSON-RPC envelope schemas (`object` / `literal` / `number` / `string` / `unknown`). No schema uses `emoji()`, and nothing calls `flatten()`; `record()` appears only in the outgoing `signPsbt` params schema. So neither valibot advisory fixed by 1.5.0 (GHSA-vqpr-j7v3-hqw9, ReDoS in `EMOJI_REGEX`; GHSA-5qjj-4xww-7phc, `record()` + `flatten()`) was reachable, but valibot is on a path that ships and 1.5.0 is the same major. That is why it is overridden rather than argued.

### Why the core override was rejected

`@sats-connect/core@0.19.0` is the only release with a fixed axios (1.20.0). Overriding to it type-checks, but it changes behaviour on the path that moves money.
- 0.19 validates success replies against `specSuccessWithExtensionsResponseSchema`. Any `extensions.warnings` entry must be a `DEPRECATION_NOTICE` with a date-only `sunsetDate`.
- When a wallet broadcasts a transfer but adds a warning 0.19 doesn't recognise, the result is "Received unknown response from provider." (`-32603`).
- `sendBtc` would then report a failed send for a payment that went out, and the user could pay twice.

A browser smoke test (Chromium, a fake Xverse provider, the real `request()` from each bundle) shows the difference. Each cell is the `getAccounts` result / the `sendTransfer` result.

| `sendTransfer` reply | core 0.10 + valibot 1.1 (`main`) | core 0.10 + valibot 1.5 (shipped) | core 0.19 + valibot 1.5 (rejected) |
|---|---|---|---|
| plain success | success / success | success / success | success / success |
| success + known `DEPRECATION_NOTICE` | success / success | success / success | success / success |
| success + unknown warning code | success / success | success / success | success / **error −32603** |
| success + datetime `sunsetDate` | success / success | success / success | success / **error −32603** |
| user rejection (4001) | success / error 4001 | success / error 4001 | success / error 4001 |
| no wallet installed: `getProviders()` | `[]` | `[]` | `[]` |

upstream has never shipped the 0.19 pairing (sats-connect 4.2.1 pins 0.10.0), and the axios it would fix is unreachable. So sats-connect stays on the core version upstream tests with. Recovering a txid from the error object instead would put code on the payment path that depends on the shape of a third-party error, to support a version pairing nobody else runs.

## 3. Solana client (4 packages)

**Packages:** `@solana/web3.js`, `jayson`, `stream-json`, `uuid`.

`@solana/web3.js` 1.x is loaded only by the Solana pay flow (`components/pay/SolanaPayFlow` via `next/dynamic`, `ssr: false`). Its browser build imports two transport libraries:

- `jayson/lib/client/browser`, the JSON-RPC client. It `require`s only `uuid` and `../../generateRequest`.
- `rpc-websockets`, whose `browser` export imports only `buffer` and `eventemitter3` and uses `window.WebSocket`.

| Package | Advisories | Why not reachable |
|---|---|---|
| `stream-json@1.9.1` | GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x, GHSA-mjw6-4jj6-33hc (filter DoS, JSONC re-scan, `Assembler` prototype pollution) | Used only by jayson's Node server and streaming utilities. The browser client never imports it, and no server bundle contains jayson. |
| `uuid@8.3.2` (+ MetaMask copies) | GHSA-w5hq-g745-h8pq (missing buffer bounds check in v3/v5/v6 **when `buf` is passed**) | jayson calls `uuid.v4()` with no arguments to make request IDs; v4 without a buffer is not affected. The MetaMask copies are in group 1 and not bundled. |
| `jayson`, `@solana/web3.js` | none of their own | Flagged only because of the two above. |

**This holds only while** `@solana/web3.js` runs only in the browser. Using it in a server component, route handler or middleware would load jayson's Node client and `rpc-websockets`' Node build, and with them stream-json and `ws`. The fix npm offers is `@solana/web3.js@3.x`, a rewrite with a different API; moving to `@solana/kit` would be its own project.

## 4. Next.js build tooling (2 packages)

**Packages:** `next`, `postcss`.

`next@15.5.28` has no advisories of its own here; it is flagged because it pins `postcss@8.4.31`. postcss runs during `next build` to process our stylesheet (`app/globals.css`, through Tailwind and `postcss.config.js`; all in the repo).

| Advisories | Needs | Why not reachable |
|---|---|---|
| GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 (2 high, 1 moderate): arbitrary `.map` file read through a `sourceMappingURL` comment | Attacker-written CSS processed at build time | Only CSS from this repo is processed. A malicious CSS change would already have to get past code review. |
| GHSA-qx2v-qp2m-jg93 (moderate): XSS through an unescaped `</style>` in stringified output | Untrusted CSS stringified into a `<style>` tag | Users can't supply CSS anywhere. postcss doesn't run in the browser or at request time. |

The fix npm offers is Next 16.

## Changes made in this review

On `main` the count was 38 (23 high, 15 moderate). Three packages were fixed with no API change:

| Package | Was | Now | How |
|---|---|---|---|
| `valibot` | 1.1.0 | 1.5.0 | Root `package.json` override (same major; sats-connect pins 1.1.0 exactly) |
| `follow-redirects` | 1.16.0 | 1.16.2 | `npm update` within axios's existing range |
| `hono` | 4.13.7 | 4.13.16 | `npm update` within porto's existing range |

No other package version changed in the lockfile.

## When to revisit

Each conclusion above depends on specific code. Redo the matching section when any of these happen:

- **Group 1:** adding any wagmi connector (WalletConnect, Coinbase Wallet / Base Account for smart-account sign-in, MetaMask SDK), or any dependency that bundles a wallet SDK. The tree then becomes shipped code, and most of its advisories need a real fix. The lint rule fails first, on purpose. Upgrading to wagmi 3 makes connectors optional peer dependencies, which would clear this group while `injected()` is the only connector. If that upgrade is done, build a mock-wallet end-to-end harness against the current version first, so the upgrade is tested against a known-good baseline.
- **Group 2:** calling any sats-connect method besides `getAccounts` and `sendTransfer` (especially `runes_*`, which uses axios), using the sats-connect `Wallet` default export, or upgrading sats-connect. Re-run the smoke-test table for any core version change.
- **Group 3:** importing `@solana/web3.js` (or `lib/solana.ts`) from server code.
- **Group 4:** accepting CSS from users anywhere, or upgrading Next (the postcss pin changes).
- **Any new advisory:** run the commands below and check whether its package falls into an existing group.

## Reproducing

```bash
# The count, and the packages with advisories of their own (the rest are flagged through dependencies)
npm audit --omit=dev
npm audit --omit=dev --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const [k,v] of Object.entries(JSON.parse(s).vulnerabilities))if(v.via.some(x=>typeof x=="object"))console.log(v.severity,k)})'

# Where a package comes from. npm ls exits 1 and reports "invalid: zod@4.6.7" on main too:
# the nested abitype copies in the connector tree ask for zod ^3 and see the hoisted 4.x.
# That is pre-existing, not caused by the overrides.
npm ls axios follow-redirects ws uuid zod --omit=dev

# Bundle check (Linux CI is the reference; on Windows the prerender step can fail for unrelated reasons)
npm run sdk:build && npm run -w paytag-web build
grep -rlF 'walletconnect' web/.next/static/chunks web/.next/server        # expect nothing
grep -rlF 'eip6963:requestProvider' web/.next/static/chunks               # expect a match (control)

# The guard
npm run -w paytag-web lint
```
