import { createConfig } from "ponder";
import { PaytagRegistryAbi } from "./abis/PaytagRegistryAbi";
import { PaytagResolverAbi } from "./abis/PaytagResolverAbi";
import { CHAIN_ID, REGISTRY_ADDRESS, RESOLVER_ADDRESS, START_BLOCK } from "./deployment";

// Database: PGlite under .ponder/ locally; Postgres when DATABASE_URL is set (production).
export default createConfig({
  chains: {
    baseSepolia: {
      id: CHAIN_ID,
      rpc: process.env.PONDER_RPC_URL_84532,
    },
  },
  contracts: {
    PaytagRegistry: {
      abi: PaytagRegistryAbi,
      chain: "baseSepolia",
      address: REGISTRY_ADDRESS,
      startBlock: START_BLOCK,
    },
    PaytagResolver: {
      abi: PaytagResolverAbi,
      chain: "baseSepolia",
      address: RESOLVER_ADDRESS,
      startBlock: START_BLOCK,
    },
  },
});
