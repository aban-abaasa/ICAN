require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('@nomicfoundation/hardhat-network-helpers');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Use the compiler that ships in the `solc` npm package (solcjs) instead of downloading a native one. This keeps the
// build reproducible from npm alone (no call to binaries.soliditylang.org), at the cost of a slower compile.
const SOLC_VERSION = require('solc/package.json').version;
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    const longVersion = String(require('solc').version()).replace(/\.Emscripten\.clang$/, '');
    return { compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true, version: SOLC_VERSION, longVersion };
  }
  return runSuper();
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: {
    // Testnet only from this repository. You run deployments with your own keys (see scripts/deploy.js); nothing here
    // reads or stores a private key.
    sepolia: {
      url: process.env.CHAIN_RPC_URL || '',
      chainId: 11155111,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  paths: { sources: './contracts', tests: './test', cache: './cache', artifacts: './artifacts' },
  mocha: { timeout: 120000 },
};
