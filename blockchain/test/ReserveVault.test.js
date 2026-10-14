const { ethers } = require('hardhat');
const { expect } = require('chai');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const U = (n) => BigInt(Math.round(n * 1e6)); // 6 decimals, like USDC

async function deploy() {
  const [deployer, guardian, alice, bob, carol, stranger, treasury] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory('MockStablecoin')).deploy();
  const vault = await (await ethers.getContractFactory('ReserveVault')).deploy(
    await usdc.getAddress(), guardian.address, 'icaneracoin Stable', 'ICEC-S');
  const token = await ethers.getContractAt('IcecStable', await vault.token());
  for (const u of [alice, bob, carol]) await usdc.mint(u.address, U(1_000_000));
  return { deployer, guardian, alice, bob, carol, stranger, treasury, usdc, vault, token };
}
const approveAndDeposit = async (f, who, amount) => {
  await f.usdc.connect(who).approve(await f.vault.getAddress(), amount);
  return f.vault.connect(who).deposit(amount);
};

describe('ReserveVault + ICEC-S (the stable form)', () => {
  describe('construction', () => {
    it('issues a token with the reserve token\'s decimals and the right metadata, owned by nobody', async () => {
      const f = await deploy();
      expect(await f.token.decimals()).to.equal(6);
      expect(await f.token.name()).to.equal('icaneracoin Stable');
      expect(await f.token.symbol()).to.equal('ICEC-S');
      expect(await f.token.vault()).to.equal(await f.vault.getAddress());
      expect(await f.vault.reserve()).to.equal(await f.usdc.getAddress());
      expect(await f.vault.guardian()).to.equal(f.guardian.address);
      expect(await f.token.totalSupply()).to.equal(0n);
    });
    it('refuses a zero reserve or zero guardian', async () => {
      const F = await ethers.getContractFactory('ReserveVault');
      const [a] = await ethers.getSigners();
      await expect(F.deploy(ethers.ZeroAddress, a.address, 'x', 'x')).to.be.revertedWithCustomError(F, 'ZeroAddress');
      const usdc = await (await ethers.getContractFactory('MockStablecoin')).deploy();
      await expect(F.deploy(await usdc.getAddress(), ethers.ZeroAddress, 'x', 'x')).to.be.revertedWithCustomError(F, 'ZeroAddress');
    });
    it('has exactly the intended functions: nothing that could withdraw the backing or mint for free', async () => {
      const f = await deploy();
      const names = f.vault.interface.fragments.filter((x) => x.type === 'function').map((x) => x.name).sort();
      expect(names).to.deep.equal(['collateralization', 'deposit', 'depositWithPermit', 'depositsPaused', 'guardian', 'redeem',
        'reserve', 'setDepositsPaused', 'sweepSurplus', 'token']);
      const tokenOnly = f.token.interface.fragments.filter((x) => x.type === 'function').map((x) => x.name);
      expect(tokenOnly).to.include.members(['mint', 'burn', 'vault']);
      expect(tokenOnly).to.not.include.members(['owner', 'transferOwnership', 'setVault', 'pause']);
    });
  });

  describe('deposit and redeem are 1:1, with no fee', () => {
    it('mints exactly what was deposited and holds exactly that in the vault', async () => {
      const f = await deploy();
      await expect(approveAndDeposit(f, f.alice, U(1234.56))).to.emit(f.vault, 'Deposited').withArgs(f.alice.address, U(1234.56), U(1234.56));
      expect(await f.token.balanceOf(f.alice.address)).to.equal(U(1234.56));
      expect(await f.usdc.balanceOf(await f.vault.getAddress())).to.equal(U(1234.56));
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(U(1_000_000) - U(1234.56));
      const [reserveBalance, supply] = await f.vault.collateralization();
      expect(reserveBalance).to.equal(supply);
    });
    it('redeems exactly what was burned, in full, at any time', async () => {
      const f = await deploy();
      await approveAndDeposit(f, f.alice, U(1000));
      await expect(f.vault.connect(f.alice).redeem(U(400))).to.emit(f.vault, 'Redeemed').withArgs(f.alice.address, U(400), U(400));
      expect(await f.token.balanceOf(f.alice.address)).to.equal(U(600));
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(U(1_000_000) - U(600));
      await f.vault.connect(f.alice).redeem(U(600));
      expect(await f.usdc.balanceOf(f.alice.address)).to.equal(U(1_000_000));
      expect(await f.token.totalSupply()).to.equal(0n);
      expect(await f.usdc.balanceOf(await f.vault.getAddress())).to.equal(0n);
    });
    it('lets holders move the token freely, and whoever holds it can redeem it', async () => {
      const f = await deploy();
      await approveAndDeposit(f, f.alice, U(500));
      await f.token.connect(f.alice).transfer(f.stranger.address, U(500));
      await f.vault.connect(f.stranger).redeem(U(500));
      expect(await f.usdc.balanceOf(f.stranger.address)).to.equal(U(500));
    });
    it('rejects zero amounts and redeeming more than you hold', async () => {
      const f = await deploy();
      await expect(f.vault.connect(f.alice).deposit(0)).to.be.revertedWithCustomError(f.vault, 'ZeroAmount');
      await expect(f.vault.connect(f.alice).redeem(0)).to.be.revertedWithCustomError(f.vault, 'ZeroAmount');
      await approveAndDeposit(f, f.alice, U(10));
      await expect(f.vault.connect(f.alice).redeem(U(10) + 1n)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientBalance');
      await expect(f.vault.connect(f.bob).redeem(1n)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientBalance');
    });
    it('rejects a deposit that was not approved', async () => {
      const f = await deploy();
      await expect(f.vault.connect(f.alice).deposit(U(5))).to.be.revertedWithCustomError(f.usdc, 'ERC20InsufficientAllowance');
    });
  });

  describe('nobody can mint without depositing, or take the backing', () => {
    it('only the vault can mint or burn the token', async () => {
      const f = await deploy();
      for (const who of [f.deployer, f.guardian, f.alice, f.stranger]) {
        await expect(f.token.connect(who).mint(who.address, 1n)).to.be.revertedWithCustomError(f.token, 'NotVault');
        await expect(f.token.connect(who).burn(f.alice.address, 1n)).to.be.revertedWithCustomError(f.token, 'NotVault');
      }
    });
    it('the guardian cannot withdraw the backing: sweepSurplus moves only what is above the supply', async () => {
      const f = await deploy();
      await approveAndDeposit(f, f.alice, U(1000));
      await expect(f.vault.connect(f.guardian).sweepSurplus(f.treasury.address)).to.be.revertedWithCustomError(f.vault, 'NothingToSweep');
      expect(await f.usdc.balanceOf(await f.vault.getAddress())).to.equal(U(1000));
    });
  });

  describe('a surplus (sent by mistake) can be recovered, and only the surplus', () => {
    it('sweeps exactly balance - supply, only for the guardian, and leaves every holder fully redeemable', async () => {
      const f = await deploy();
      await approveAndDeposit(f, f.alice, U(1000));
      await f.usdc.connect(f.bob).transfer(await f.vault.getAddress(), U(250)); // a mistaken direct transfer
      const [reserveBalance, supply] = await f.vault.collateralization();
      expect(reserveBalance - supply).to.equal(U(250));
      await expect(f.vault.connect(f.stranger).sweepSurplus(f.treasury.address)).to.be.revertedWithCustomError(f.vault, 'NotGuardian');
      await expect(f.vault.connect(f.guardian).sweepSurplus(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.vault, 'ZeroAddress');
      await expect(f.vault.connect(f.guardian).sweepSurplus(f.treasury.address)).to.emit(f.vault, 'SurplusSwept').withArgs(f.treasury.address, U(250));
      expect(await f.usdc.balanceOf(f.treasury.address)).to.equal(U(250));
      const [r2, s2] = await f.vault.collateralization();
      expect(r2).to.equal(s2);
      await f.vault.connect(f.alice).redeem(U(1000)); // still fully backed
      expect(await f.token.totalSupply()).to.equal(0n);
    });
  });

  describe('pausing', () => {
    it('the guardian can pause deposits only; redemption always works', async () => {
      const f = await deploy();
      await approveAndDeposit(f, f.alice, U(100));
      await expect(f.vault.connect(f.stranger).setDepositsPaused(true)).to.be.revertedWithCustomError(f.vault, 'NotGuardian');
      await expect(f.vault.connect(f.guardian).setDepositsPaused(true)).to.emit(f.vault, 'DepositsPausedSet').withArgs(true);
      await f.usdc.connect(f.bob).approve(await f.vault.getAddress(), U(5));
      await expect(f.vault.connect(f.bob).deposit(U(5))).to.be.revertedWithCustomError(f.vault, 'DepositsArePaused');
      await f.vault.connect(f.alice).redeem(U(100)); // still open
      expect(await f.token.balanceOf(f.alice.address)).to.equal(0n);
      await f.vault.connect(f.guardian).setDepositsPaused(false);
      await f.vault.connect(f.bob).deposit(U(5));
      expect(await f.token.balanceOf(f.bob.address)).to.equal(U(5));
    });
  });

  describe('permit (one-transaction deposit)', () => {
    const sign = async (f, owner, value, deadline) => {
      const domain = { name: 'Mock USD Coin', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await f.usdc.getAddress() };
      const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
      const nonce = await f.usdc.nonces(owner.address);
      const sig = ethers.Signature.from(await owner.signTypedData(domain, types, { owner: owner.address, spender: await f.vault.getAddress(), value, nonce, deadline }));
      return sig;
    };
    it('deposits with a signature and no prior approve', async () => {
      const f = await deploy();
      const deadline = (await time.latest()) + 3600;
      const sig = await sign(f, f.alice, U(300), deadline);
      await f.vault.connect(f.alice).depositWithPermit(U(300), deadline, sig.v, sig.r, sig.s);
      expect(await f.token.balanceOf(f.alice.address)).to.equal(U(300));
    });
    it('still works if someone front-runs the permit with the same signature', async () => {
      const f = await deploy();
      const deadline = (await time.latest()) + 3600;
      const sig = await sign(f, f.alice, U(300), deadline);
      await f.usdc.connect(f.stranger).permit(f.alice.address, await f.vault.getAddress(), U(300), deadline, sig.v, sig.r, sig.s);
      await f.vault.connect(f.alice).depositWithPermit(U(300), deadline, sig.v, sig.r, sig.s);
      expect(await f.token.balanceOf(f.alice.address)).to.equal(U(300));
    });
    it('a bad signature gives no allowance, so the deposit fails', async () => {
      const f = await deploy();
      const deadline = (await time.latest()) + 3600;
      const sig = await sign(f, f.bob, U(300), deadline); // signed by bob, used by alice
      await expect(f.vault.connect(f.alice).depositWithPermit(U(300), deadline, sig.v, sig.r, sig.s)).to.be.reverted;
      expect(await f.token.totalSupply()).to.equal(0n);
    });
    it('an expired signature fails', async () => {
      const f = await deploy();
      const deadline = (await time.latest()) + 10;
      const sig = await sign(f, f.alice, U(300), deadline);
      await time.increase(100);
      await expect(f.vault.connect(f.alice).depositWithPermit(U(300), deadline, sig.v, sig.r, sig.s)).to.be.reverted;
    });
  });

  describe('hostile reserve tokens', () => {
    it('a fee-on-transfer reserve cannot make the vault issue more than it received', async () => {
      const [, guardian, alice] = await ethers.getSigners();
      const fee = await (await ethers.getContractFactory('MockFeeToken')).deploy(100, false); // 1%, receiver pays
      const vault = await (await ethers.getContractFactory('ReserveVault')).deploy(await fee.getAddress(), guardian.address, 'S', 'S');
      const token = await ethers.getContractAt('IcecStable', await vault.token());
      await fee.mint(alice.address, U(1000));
      await fee.connect(alice).approve(await vault.getAddress(), U(1000));
      await vault.connect(alice).deposit(U(1000));
      expect(await token.balanceOf(alice.address)).to.equal(U(990)); // what actually arrived
      const [r, s] = await vault.collateralization();
      expect(r).to.equal(s);
    });
    it('a reserve that charges the SENDER on the way out cannot drain the vault: the redeem reverts and nothing is lost', async () => {
      const [, guardian, alice] = await ethers.getSigners();
      const fee = await (await ethers.getContractFactory('MockFeeToken')).deploy(100, true); // 1% on top, sender pays
      const vault = await (await ethers.getContractFactory('ReserveVault')).deploy(await fee.getAddress(), guardian.address, 'S', 'S');
      const token = await ethers.getContractAt('IcecStable', await vault.token());
      await fee.mint(alice.address, U(2000));
      await fee.connect(alice).approve(await vault.getAddress(), U(1000));
      await vault.connect(alice).deposit(U(1000));
      await expect(vault.connect(alice).redeem(U(500))).to.be.revertedWithCustomError(vault, 'InvariantBroken');
      expect(await token.balanceOf(alice.address)).to.equal(U(1000)); // the revert rolled the burn back too
    });
    it('a reserve token that calls back into deposit() during a transfer is stopped by the reentrancy guard', async () => {
      const [, guardian, alice] = await ethers.getSigners();
      const re = await (await ethers.getContractFactory('MockReentrantToken')).deploy();
      const vault = await (await ethers.getContractFactory('ReserveVault')).deploy(await re.getAddress(), guardian.address, 'S', 'S');
      await re.mint(alice.address, U(1000));
      await re.connect(alice).approve(await vault.getAddress(), U(1000));
      await re.arm(await vault.getAddress(), 1);
      await expect(vault.connect(alice).deposit(U(100))).to.be.revertedWithCustomError(vault, 'ReentrancyGuardReentrantCall');
      expect(await (await ethers.getContractAt('IcecStable', await vault.token())).totalSupply()).to.equal(0n);
    });
    it('a reserve token that calls back into redeem() during a transfer is stopped too', async () => {
      const [, guardian, alice] = await ethers.getSigners();
      const re = await (await ethers.getContractFactory('MockReentrantToken')).deploy();
      const vault = await (await ethers.getContractFactory('ReserveVault')).deploy(await re.getAddress(), guardian.address, 'S', 'S');
      const token = await ethers.getContractAt('IcecStable', await vault.token());
      await re.mint(alice.address, U(1000));
      await re.connect(alice).approve(await vault.getAddress(), U(1000));
      await vault.connect(alice).deposit(U(500));
      await re.arm(await vault.getAddress(), 2);
      await expect(vault.connect(alice).redeem(U(100))).to.be.revertedWithCustomError(vault, 'ReentrancyGuardReentrantCall');
      expect(await token.balanceOf(alice.address)).to.equal(U(500));
    });
  });

  describe('randomized sequences: the invariant holds after every single step', () => {
    // a small seeded PRNG so a failure can be replayed
    const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (const seed of [1, 7, 42]) {
      it(`seed ${seed}: 250 random deposits, redeems, donations, sweeps and pauses match a shadow model`, async () => {
        const f = await deploy();
        const rand = rng(seed);
        const users = [f.alice, f.bob, f.carol];
        const model = { bal: new Map(users.map((u) => [u.address, 0n])), supply: 0n, surplus: 0n, paused: false };
        const vaultAddr = await f.vault.getAddress();
        const pick = (arr) => arr[Math.floor(rand() * arr.length)];
        const amt = (max) => (max === 0n ? 0n : (BigInt(Math.floor(rand() * 1e9)) % max) + 1n);

        for (let step = 0; step < 250; step++) {
          const op = pick(['deposit', 'deposit', 'redeem', 'redeem', 'donate', 'sweep', 'pause', 'transfer']);
          const u = pick(users);
          if (op === 'deposit') {
            const bal = await f.usdc.balanceOf(u.address);
            const a = amt(bal < U(50_000) ? bal : U(50_000));
            await f.usdc.connect(u).approve(vaultAddr, a);
            if (model.paused) { await expect(f.vault.connect(u).deposit(a)).to.be.revertedWithCustomError(f.vault, 'DepositsArePaused'); }
            else { await f.vault.connect(u).deposit(a); model.bal.set(u.address, model.bal.get(u.address) + a); model.supply += a; }
          } else if (op === 'redeem') {
            const held = model.bal.get(u.address);
            if (held > 0n) { const a = amt(held); await f.vault.connect(u).redeem(a); model.bal.set(u.address, held - a); model.supply -= a; }
          } else if (op === 'donate') {
            const bal = await f.usdc.balanceOf(u.address);
            const a = amt(bal < U(1000) ? bal : U(1000));
            await f.usdc.connect(u).transfer(vaultAddr, a); model.surplus += a;
          } else if (op === 'sweep') {
            if (model.surplus > 0n) { await f.vault.connect(f.guardian).sweepSurplus(f.treasury.address); model.surplus = 0n; }
            else { await expect(f.vault.connect(f.guardian).sweepSurplus(f.treasury.address)).to.be.revertedWithCustomError(f.vault, 'NothingToSweep'); }
          } else if (op === 'pause') {
            model.paused = !model.paused; await f.vault.connect(f.guardian).setDepositsPaused(model.paused);
          } else {
            const to = pick(users); const held = model.bal.get(u.address);
            if (held > 0n && to.address !== u.address) { const a = amt(held); await f.token.connect(u).transfer(to.address, a); model.bal.set(u.address, held - a); model.bal.set(to.address, model.bal.get(to.address) + a); }
          }
          // ---- after EVERY step
          const [reserveBalance, supply] = await f.vault.collateralization();
          expect(reserveBalance, `step ${step} ${op}: reserve must cover supply`).to.be.gte(supply);
          expect(supply, `step ${step} ${op}: supply matches the model`).to.equal(model.supply);
          expect(reserveBalance, `step ${step} ${op}: reserve = supply + surplus`).to.equal(model.supply + model.surplus);
          let sum = 0n;
          for (const w of users) { const b = await f.token.balanceOf(w.address); expect(b).to.equal(model.bal.get(w.address)); sum += b; }
          expect(sum).to.equal(supply);
        }
        // finally everyone can get out, in full
        for (const u of users) { const held = model.bal.get(u.address); if (held > 0n) await f.vault.connect(u).redeem(held); }
        expect(await f.token.totalSupply()).to.equal(0n);
      });
    }
  });
});
