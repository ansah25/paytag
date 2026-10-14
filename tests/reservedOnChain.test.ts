import { readFileSync } from 'fs';
import { join } from 'path';
import { keccak256, toUtf8Bytes } from 'ethers';
import { RESERVED_USERNAMES } from '../src/services/userService';

// The on-chain registry hard-codes keccak256 hashes of the reserved usernames and is immutable,
// so the two lists can only drift by someone editing RESERVED_USERNAMES. This test makes that
// drift loud: a new reserved name needs a contract redeploy to be enforced on-chain.
describe('reserved usernames match the on-chain PaytagRegistry blocklist', () => {
  const source = readFileSync(
    join(__dirname, '..', 'contracts', 'src', 'PaytagRegistry.sol'),
    'utf8',
  ).toLowerCase();
  const onChainHashes = new Set(source.match(/node == (0x[0-9a-f]{64})/g)?.map((m) => m.slice(8)));

  it.each([...RESERVED_USERNAMES])('"%s" is blocked on-chain', (name) => {
    expect(onChainHashes.has(keccak256(toUtf8Bytes(name)))).toBe(true);
  });

  it('the contract blocks nothing the API does not reserve', () => {
    expect(onChainHashes.size).toBe(RESERVED_USERNAMES.size);
  });
});
