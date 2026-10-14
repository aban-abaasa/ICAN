// Deploys the two icaneracoin tokens to a TEST network and prints exactly what to put in the database.
//
//   ICEC-S   ReserveVault + IcecStable : a US-dollar token backed 1:1 by a stablecoin held in the vault
//   ICEC-C   IcecCommunity             : the non-transferable receipt for ledger icaneracoin, minted by the bridge operator
//
// You run this, with your own key, on your own machine:
//
//   cd blockchain
//   CHAIN_RPC_URL=https://...  DEPLOYER_PRIVATE_KEY=0x...  \
//   RESERVE_TOKEN=0x<the test stablecoin's address on this network>  \
//   OWNER_ADDRESS=0x<multisig>  GUARDIAN_ADDRESS=0x<second key>  OPERATOR_ADDRESS=0x<the relayer's address>  \
//   npx hardhat run scripts/deploy.js --network sepolia
//
// For a throwaway local chain (npx hardhat node in another terminal):
//   DEPLOY_MOCK_RESERVE=1 npx hardhat run scripts/deploy.js --network localhost
//
// What it will NOT do: read a key from anywhere but your environment, write one anywhere, or deploy to a main network (it refuses
// the well-known ones; there is no override: mainnet needs an audit and a deliberate, separate step; see CHAIN_TOKENS_DEPLOY.md).
// OPERATOR_ADDRESS is only an ADDRESS: this script never sees the relayer's key.

const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

// Known main networks. Deploying unaudited contracts to one of these from this script is refused.
const MAIN_NETWORKS = new Set([1, 10, 56, 100, 137, 250, 324, 1101, 5000, 8453, 42161, 42220, 43114, 59144, 534352]);
const need = (name) => { const v = String(process.env[name] || '').trim(); if (!v) throw new Error(`${name} is required`); return v; };
const addr = (name, fallback) => {
  const v = String(process.env[name] || fallback || '').trim();
  if (!hre.ethers.isAddress(v)) throw new Error(`${name} must be an address`);
  return hre.ethers.getAddress(v);
};

async function main() {
  const { ethers } = hre;
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (MAIN_NETWORKS.has(chainId)) throw new Error(`chain ${chainId} is a main network. These contracts are unaudited and this script will not deploy them there.`);
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer account: set DEPLOYER_PRIVATE_KEY (or use --network localhost)');

  const mock = process.env.DEPLOY_MOCK_RESERVE === '1';
  const isLocal = chainId === 31337;
  if (mock && !isLocal && process.env.ALLOW_MOCK_ON_TESTNET !== 'yes') {
    throw new Error('DEPLOY_MOCK_RESERVE=1 deploys a stablecoin anyone can mint. On a public testnet that is only for demos: set ALLOW_MOCK_ON_TESTNET=yes to confirm, or point RESERVE_TOKEN at the real test stablecoin.');
  }
  const owner = addr('OWNER_ADDRESS', isLocal ? deployer.address : '');
  const guardian = addr('GUARDIAN_ADDRESS', isLocal ? deployer.address : '');
  const operator = addr('OPERATOR_ADDRESS', isLocal ? deployer.address : '');
  const capIcec = BigInt(process.env.DAILY_MINT_CAP_ICEC || '1000');
  if (capIcec <= 0n) throw new Error('DAILY_MINT_CAP_ICEC must be positive');
  if (!isLocal && new Set([owner, guardian, operator].map((a) => a.toLowerCase())).size < 3) {
    console.warn('WARNING: owner, guardian and operator are not three different addresses. In production the owner is a multisig, the guardian a separate key, and the operator the relayer\'s hot key.');
  }
  console.log(`Network ${net.name} (chain ${chainId}); deployer ${deployer.address}`);

  let reserve;
  if (mock) {
    const Mock = await ethers.getContractFactory('MockStablecoin');
    const m = await Mock.deploy();
    await m.waitForDeployment();
    reserve = await m.getAddress();
    console.log(`Mock stablecoin: ${reserve} (anyone can mint it: for demos only)`);
  } else {
    reserve = addr('RESERVE_TOKEN');
    const code = await ethers.provider.getCode(reserve);
    if (code === '0x') throw new Error(`No contract at RESERVE_TOKEN ${reserve} on chain ${chainId}`);
    const t = new ethers.Contract(reserve, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'], ethers.provider);
    console.log(`Reserve token: ${await t.symbol()} (${await t.decimals()} decimals) at ${reserve}. Check this is the issuer's real address on this network.`);
  }

  const Vault = await ethers.getContractFactory('ReserveVault');
  const vault = await Vault.deploy(reserve, guardian, 'icaneracoin Stable', 'ICEC-S');
  await vault.waitForDeployment();
  const stableToken = await vault.token();
  console.log(`ICEC-S vault:  ${await vault.getAddress()}\nICEC-S token:  ${stableToken}`);

  const Community = await ethers.getContractFactory('IcecCommunity');
  const community = await Community.deploy(owner, operator, guardian, capIcec * 10n ** 8n);
  await community.waitForDeployment();
  const communityAddress = await community.getAddress();
  const deployBlock = (await community.deploymentTransaction().wait()).blockNumber;
  console.log(`ICEC-C:        ${communityAddress} (block ${deployBlock})`);

  const out = {
    network: net.name, chainId, deployedAt: new Date().toISOString(), deployer: deployer.address, owner, guardian, operator, dailyMintCapIcec: capIcec.toString(),
    reserveToken: reserve, stableVault: await vault.getAddress(), stableToken, icecCommunity: communityAddress, icecCommunityDeployBlock: deployBlock,
  };
  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}${isLocal ? '.local' : ''}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nSaved ${path.relative(process.cwd(), file)} (addresses only: no keys).\n`);

  console.log('Next, in the Supabase SQL editor (the dev token is the one the dev panel uses):');
  console.log(`  SELECT public.ican_chain_dev_set_contracts('<dev token>', '${JSON.stringify({
    chain_id: chainId, icec_community_address: communityAddress, stable_vault_address: await vault.getAddress(), stable_token_address: stableToken, reserve_token_address: reserve,
  })}'::jsonb);`);
  console.log('  SELECT public.ican_chain_dev_set_settings(\'<dev token>\', \'{"chain_name": "<network name>", "explorer_url": "https://<explorer>", "confirmations": 12}\'::jsonb);');
  console.log(`And in the host's environment: CHAIN_ID=${chainId}  CHAIN_START_BLOCK=${deployBlock}  (plus CHAIN_RPC_URL, BRIDGE_OPERATOR_KEY for ${operator}, CHAIN_CRON_SECRET).`);
  console.log('The bridge stays OFF until you turn it on in the dev panel.');
}

main().catch((e) => { console.error(`\nNot deployed: ${e.message}`); process.exitCode = 1; });
