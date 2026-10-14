const { ethers } = require('hardhat');
const { expect } = require('chai');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const C = (n) => BigInt(Math.round(n * 1e8)); // 8 decimals, like the ledger
const id = (s) => ethers.id(s);              // a withdrawal / credit id (bytes32)

async function deploy(capCoins = 1000) {
  const [owner, operator, guardian, alice, bob, carol, stranger, owner2] = await ethers.getSigners();
  const F = await ethers.getContractFactory('IcecCommunity');
  const icec = await F.deploy(owner.address, operator.address, guardian.address, C(capCoins));
  return { F, icec, owner, operator, guardian, alice, bob, carol, stranger, owner2 };
}

describe('IcecCommunity (ICEC-C, the community form, mirrored on-chain)', () => {
  describe('construction', () => {
    it('has the metadata and 8 decimals of the ledger, and the roles it was given', async () => {
      const f = await deploy();
      expect(await f.icec.name()).to.equal('icaneracoin Community');
      expect(await f.icec.symbol()).to.equal('ICEC-C');
      expect(await f.icec.decimals()).to.equal(8);
      expect(await f.icec.owner()).to.equal(f.owner.address);
      expect(await f.icec.operator()).to.equal(f.operator.address);
      expect(await f.icec.guardian()).to.equal(f.guardian.address);
      expect(await f.icec.dailyMintCap()).to.equal(C(1000));
      expect(await f.icec.mintPaused()).to.equal(false);
      expect(await f.icec.totalSupply()).to.equal(0n);
    });

    it('has no price, no reserve, no transfer: only the functions it should', async () => {
      const f = await deploy();
      const names = f.icec.interface.fragments.filter((x) => x.type === 'function').map((x) => x.name).sort();
      expect(names).to.deep.equal([
        'acceptOwnership', 'allowance', 'approve', 'balanceOf', 'burnForCredit', 'dailyMintCap', 'decimals', 'guardian',
        'mint', 'mintPaused', 'mintableToday', 'mintedByDay', 'name', 'operator', 'owner', 'pauseMint', 'pendingOwner',
        'processed', 'renounceOwnership', 'setDailyMintCap', 'setGuardian', 'setOperator', 'symbol', 'totalSupply',
        'transfer', 'transferFrom', 'transferOwnership', 'unpauseMint',
      ]);
    });
  });

  describe('minting (the bridge operator, once per withdrawal)', () => {
    it('mints exactly the requested amount to the recipient and records the withdrawal', async () => {
      const f = await deploy();
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(12.5), id('w1')))
        .to.emit(f.icec, 'Minted').withArgs(id('w1'), f.alice.address, C(12.5));
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(12.5));
      expect(await f.icec.totalSupply()).to.equal(C(12.5));
      expect(await f.icec.processed(id('w1'))).to.equal(true);
      expect(await f.icec.processed(id('w2'))).to.equal(false);
    });

    it('only the operator can mint: not the owner, the guardian, a holder or a stranger', async () => {
      const f = await deploy();
      for (const who of [f.owner, f.guardian, f.alice, f.stranger]) {
        await expect(f.icec.connect(who).mint(who.address, C(1), id('x'))).to.be.revertedWithCustomError(f.icec, 'NotOperator');
      }
      expect(await f.icec.totalSupply()).to.equal(0n);
    });

    it('a withdrawal id works once: a retry, even for a different amount or recipient, reverts and changes nothing', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(5), id('w1'));
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(5), id('w1')))
        .to.be.revertedWithCustomError(f.icec, 'AlreadyProcessed').withArgs(id('w1'));
      await expect(f.icec.connect(f.operator).mint(f.bob.address, C(9), id('w1')))
        .to.be.revertedWithCustomError(f.icec, 'AlreadyProcessed');
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(5));
      expect(await f.icec.balanceOf(f.bob.address)).to.equal(0n);
      expect(await f.icec.totalSupply()).to.equal(C(5));
      expect(await f.icec.mintedByDay(Math.floor((await time.latest()) / 86400))).to.equal(C(5));
    });

    it('an id that was minted and then burned still cannot be minted again', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(5), id('w1'));
      await f.icec.connect(f.alice).burnForCredit(C(5), id('c1'));
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(5), id('w1'))).to.be.revertedWithCustomError(f.icec, 'AlreadyProcessed');
      expect(await f.icec.totalSupply()).to.equal(0n);
    });

    it('refuses a zero amount and the zero address', async () => {
      const f = await deploy();
      await expect(f.icec.connect(f.operator).mint(f.alice.address, 0, id('w'))).to.be.revertedWithCustomError(f.icec, 'ZeroAmount');
      await expect(f.icec.connect(f.operator).mint(ethers.ZeroAddress, C(1), id('w'))).to.be.revertedWithCustomError(f.icec, 'ZeroAddress');
      expect(await f.icec.processed(id('w'))).to.equal(false); // a refused mint does not burn the id
    });

    it('a failed mint does not consume the withdrawal id', async () => {
      const f = await deploy(10);
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(11), id('w1'))).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded');
      expect(await f.icec.processed(id('w1'))).to.equal(false);
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('w1')); // a smaller request with that id still works
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(10));
    });
  });

  describe('the daily mint cap', () => {
    it('allows minting up to exactly the cap in a day and refuses the next base unit', async () => {
      const f = await deploy(100);
      await f.icec.connect(f.operator).mint(f.alice.address, C(60), id('a'));
      expect(await f.icec.mintableToday()).to.equal(C(40));
      await f.icec.connect(f.operator).mint(f.bob.address, C(40), id('b'));
      expect(await f.icec.mintableToday()).to.equal(0n);
      await expect(f.icec.connect(f.operator).mint(f.carol.address, 1n, id('c')))
        .to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded').withArgs(1n, 0n);
      expect(await f.icec.totalSupply()).to.equal(C(100));
    });

    it('reports the remaining room when a request is too large', async () => {
      const f = await deploy(100);
      await f.icec.connect(f.operator).mint(f.alice.address, C(70), id('a'));
      await expect(f.icec.connect(f.operator).mint(f.bob.address, C(31), id('b')))
        .to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded').withArgs(C(31), C(30));
    });

    it('resets on the next UTC day', async () => {
      const f = await deploy(100);
      await f.icec.connect(f.operator).mint(f.alice.address, C(100), id('a'));
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(1), id('b'))).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded');
      await time.increase(86400); // into the next day
      expect(await f.icec.mintableToday()).to.equal(C(100));
      await f.icec.connect(f.operator).mint(f.alice.address, C(100), id('b'));
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(200));
    });

    it('burning does not give back room under the cap (a stolen key cannot recycle it)', async () => {
      const f = await deploy(100);
      await f.icec.connect(f.operator).mint(f.alice.address, C(100), id('a'));
      await f.icec.connect(f.alice).burnForCredit(C(100), id('c'));
      expect(await f.icec.mintableToday()).to.equal(0n);
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(1), id('b'))).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded');
    });

    it('a lowered cap applies immediately, including below what was already minted today', async () => {
      const f = await deploy(100);
      await f.icec.connect(f.operator).mint(f.alice.address, C(80), id('a'));
      await f.icec.connect(f.owner).setDailyMintCap(C(50));
      expect(await f.icec.mintableToday()).to.equal(0n);
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(1), id('b'))).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded').withArgs(C(1), 0n);
      await f.icec.connect(f.owner).setDailyMintCap(C(200));
      expect(await f.icec.mintableToday()).to.equal(C(120));
    });

    it('a cap of zero switches minting off', async () => {
      const f = await deploy(0);
      await expect(f.icec.connect(f.operator).mint(f.alice.address, 1n, id('a'))).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded');
    });
  });

  describe('pause', () => {
    it('the guardian and the owner can pause minting; nobody else can', async () => {
      const f = await deploy();
      await expect(f.icec.connect(f.stranger).pauseMint()).to.be.revertedWithCustomError(f.icec, 'NotGuardianOrOwner');
      await expect(f.icec.connect(f.operator).pauseMint()).to.be.revertedWithCustomError(f.icec, 'NotGuardianOrOwner');
      await expect(f.icec.connect(f.guardian).pauseMint()).to.emit(f.icec, 'MintPausedSet').withArgs(true);
      expect(await f.icec.mintPaused()).to.equal(true);
      await f.icec.connect(f.owner).unpauseMint();
      await expect(f.icec.connect(f.owner).pauseMint()).to.emit(f.icec, 'MintPausedSet').withArgs(true);
    });

    it('only the owner can resume: the guardian cannot undo its own pause', async () => {
      const f = await deploy();
      await f.icec.connect(f.guardian).pauseMint();
      await expect(f.icec.connect(f.guardian).unpauseMint()).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
      await expect(f.icec.connect(f.operator).unpauseMint()).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
      expect(await f.icec.mintPaused()).to.equal(true);
      await expect(f.icec.connect(f.owner).unpauseMint()).to.emit(f.icec, 'MintPausedSet').withArgs(false);
    });

    it('stops minting but never stops burning', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await f.icec.connect(f.guardian).pauseMint();
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(1), id('b'))).to.be.revertedWithCustomError(f.icec, 'MintIsPaused');
      await expect(f.icec.connect(f.alice).burnForCredit(C(10), id('c1'))).to.emit(f.icec, 'BurnedForCredit');
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(0n);
    });

    it('a paused mint does not consume the withdrawal id', async () => {
      const f = await deploy();
      await f.icec.connect(f.guardian).pauseMint();
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(1), id('w'))).to.be.revertedWithCustomError(f.icec, 'MintIsPaused');
      await f.icec.connect(f.owner).unpauseMint();
      await f.icec.connect(f.operator).mint(f.alice.address, C(1), id('w'));
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(1));
    });
  });

  describe('burn for credit (the way back to the ledger)', () => {
    it('burns the holder\'s own tokens and emits what the bridge listens for', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await expect(f.icec.connect(f.alice).burnForCredit(C(4), id('credit-1')))
        .to.emit(f.icec, 'BurnedForCredit').withArgs(f.alice.address, C(4), id('credit-1'));
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(6));
      expect(await f.icec.totalSupply()).to.equal(C(6));
    });

    it('cannot burn more than the holder has, burn zero, or burn someone else\'s tokens', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await expect(f.icec.connect(f.alice).burnForCredit(C(10) + 1n, id('c'))).to.be.revertedWithCustomError(f.icec, 'ERC20InsufficientBalance');
      await expect(f.icec.connect(f.alice).burnForCredit(0, id('c'))).to.be.revertedWithCustomError(f.icec, 'ZeroAmount');
      await expect(f.icec.connect(f.bob).burnForCredit(1n, id('c'))).to.be.revertedWithCustomError(f.icec, 'ERC20InsufficientBalance'); // bob has none
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(10));
    });

    it('the same credit id can be reused by the user without breaking anything (matching is the bridge\'s job)', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await f.icec.connect(f.alice).burnForCredit(C(1), id('same'));
      await f.icec.connect(f.alice).burnForCredit(C(1), id('same'));
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(8));
    });
  });

  describe('it cannot be transferred', () => {
    it('transfer reverts for a holder, for the full balance and for one base unit', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await expect(f.icec.connect(f.alice).transfer(f.bob.address, C(10))).to.be.revertedWithCustomError(f.icec, 'NonTransferable');
      await expect(f.icec.connect(f.alice).transfer(f.bob.address, 1n)).to.be.revertedWithCustomError(f.icec, 'NonTransferable');
      await expect(f.icec.connect(f.alice).transfer(f.alice.address, 1n)).to.be.revertedWithCustomError(f.icec, 'NonTransferable'); // not even to self
      await expect(f.icec.connect(f.alice).transfer(f.bob.address, 0n)).to.be.revertedWithCustomError(f.icec, 'NonTransferable');   // not even zero
    });

    it('transferFrom reverts even with an allowance, from anyone: holder, owner, operator, guardian', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      for (const spender of [f.bob, f.owner, f.operator, f.guardian]) {
        await f.icec.connect(f.alice).approve(spender.address, C(10));
        await expect(f.icec.connect(spender).transferFrom(f.alice.address, spender.address, C(1)))
          .to.be.revertedWithCustomError(f.icec, 'NonTransferable');
      }
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(10));
    });

    it('the zero-address burn path and the mint path are the only ways a balance changes (nothing reaches the dead address)', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await expect(f.icec.connect(f.alice).transfer(ethers.ZeroAddress, C(1))).to.be.reverted; // ERC20 refuses the zero receiver
      await expect(f.icec.connect(f.alice).transfer('0x000000000000000000000000000000000000dEaD', C(1)))
        .to.be.revertedWithCustomError(f.icec, 'NonTransferable');
    });

    it('the owner has no way to move or seize anyone\'s balance', async () => {
      const f = await deploy();
      await f.icec.connect(f.operator).mint(f.alice.address, C(10), id('a'));
      await expect(f.icec.connect(f.owner).transferFrom(f.alice.address, f.owner.address, C(1))).to.be.reverted;
      const names = f.icec.interface.fragments.filter((x) => x.type === 'function').map((x) => x.name);
      expect(names).to.not.include.members(['burn', 'burnFrom', 'forceTransfer', 'seize', 'rescue', 'sweep']);
    });
  });

  describe('owner, guardian and operator management', () => {
    it('only the owner can change the operator, guardian and cap, each with an event', async () => {
      const f = await deploy();
      for (const who of [f.guardian, f.operator, f.alice, f.stranger]) {
        await expect(f.icec.connect(who).setOperator(who.address)).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
        await expect(f.icec.connect(who).setGuardian(who.address)).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
        await expect(f.icec.connect(who).setDailyMintCap(C(1e9))).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
      }
      await expect(f.icec.connect(f.owner).setOperator(f.carol.address)).to.emit(f.icec, 'OperatorSet').withArgs(f.carol.address);
      await expect(f.icec.connect(f.owner).setGuardian(f.bob.address)).to.emit(f.icec, 'GuardianSet').withArgs(f.bob.address);
      await expect(f.icec.connect(f.owner).setDailyMintCap(C(7))).to.emit(f.icec, 'DailyMintCapSet').withArgs(C(7));
    });

    it('rotating the operator moves the minting right: the old key is dead at once', async () => {
      const f = await deploy();
      await f.icec.connect(f.owner).setOperator(f.carol.address);
      await expect(f.icec.connect(f.operator).mint(f.alice.address, C(1), id('a'))).to.be.revertedWithCustomError(f.icec, 'NotOperator');
      await f.icec.connect(f.carol).mint(f.alice.address, C(1), id('a'));
      expect(await f.icec.balanceOf(f.alice.address)).to.equal(C(1));
    });

    it('the operator can be set to the zero address, which switches minting off', async () => {
      const f = await deploy();
      await f.icec.connect(f.owner).setOperator(ethers.ZeroAddress);
      for (const who of [f.operator, f.owner, f.stranger]) {
        await expect(f.icec.connect(who).mint(f.alice.address, C(1), id('a'))).to.be.revertedWithCustomError(f.icec, 'NotOperator');
      }
    });

    it('the daily cap already used today survives an operator rotation (the cap is the contract\'s, not the key\'s)', async () => {
      const f = await deploy(100);
      await f.icec.connect(f.operator).mint(f.alice.address, C(100), id('a'));
      await f.icec.connect(f.owner).setOperator(f.carol.address);
      await expect(f.icec.connect(f.carol).mint(f.alice.address, C(1), id('b'))).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded');
    });

    it('ownership cannot be renounced (it would freeze a pause and the roles forever)', async () => {
      const f = await deploy();
      await expect(f.icec.connect(f.owner).renounceOwnership()).to.be.revertedWithCustomError(f.icec, 'RenounceDisabled');
      expect(await f.icec.owner()).to.equal(f.owner.address);
    });

    it('ownership moves in two steps, so a typo cannot hand the contract to nobody', async () => {
      const f = await deploy();
      await f.icec.connect(f.owner).transferOwnership(f.owner2.address);
      expect(await f.icec.owner()).to.equal(f.owner.address); // not yet
      expect(await f.icec.pendingOwner()).to.equal(f.owner2.address);
      await expect(f.icec.connect(f.stranger).acceptOwnership()).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
      await expect(f.icec.connect(f.owner).setDailyMintCap(C(5))).to.not.be.reverted; // old owner still in charge until accepted
      await f.icec.connect(f.owner2).acceptOwnership();
      expect(await f.icec.owner()).to.equal(f.owner2.address);
      await expect(f.icec.connect(f.owner).setDailyMintCap(C(5))).to.be.revertedWithCustomError(f.icec, 'OwnableUnauthorizedAccount');
      await f.icec.connect(f.owner2).setDailyMintCap(C(5));
    });
  });

  describe('randomized sequences: supply always equals what was minted minus what was burned', () => {
    for (const seed of [3, 11, 99]) {
      it(`seed ${seed}: 250 mixed operations against a shadow model`, async () => {
        const f = await deploy(500);
        const holders = [f.alice, f.bob, f.carol];
        let s = seed;
        const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };

        const bal = new Map(holders.map((h) => [h.address, 0n]));
        const minted = new Set();
        let supply = 0n;
        let mintedToday = 0n;
        let day = Math.floor((await time.latest()) / 86400);
        let wid = 0;

        for (let step = 0; step < 250; step++) {
          const r = rnd();
          const who = holders[Math.floor(rnd() * holders.length)];
          if (r < 0.40) {                                   // operator mints (sometimes a repeat id, sometimes over the cap)
            const reuse = minted.size > 0 && rnd() < 0.2;
            const wId = reuse ? id(`w${Math.floor(rnd() * wid)}`) : id(`w${wid++}`);
            const amount = BigInt(1 + Math.floor(rnd() * 200)) * 1_000_000n;
            const room = 500n * 100_000_000n - mintedToday;
            const call = f.icec.connect(f.operator).mint(who.address, amount, wId);
            if (minted.has(wId)) await expect(call).to.be.revertedWithCustomError(f.icec, 'AlreadyProcessed');
            else if (amount > room) await expect(call).to.be.revertedWithCustomError(f.icec, 'DailyCapExceeded');
            else {
              await call;
              minted.add(wId); mintedToday += amount; supply += amount; bal.set(who.address, bal.get(who.address) + amount);
            }
          } else if (r < 0.65) {                            // holder burns part of a balance (or tries to burn too much)
            const have = bal.get(who.address);
            const tooMuch = rnd() < 0.15;
            const amount = tooMuch ? have + 1n : have === 0n ? 0n : BigInt(1 + Math.floor(rnd() * Number(have)));
            const call = f.icec.connect(who).burnForCredit(amount, id(`c${step}`));
            if (amount === 0n) await expect(call).to.be.revertedWithCustomError(f.icec, 'ZeroAmount');
            else if (tooMuch) await expect(call).to.be.revertedWithCustomError(f.icec, 'ERC20InsufficientBalance');
            else { await call; supply -= amount; bal.set(who.address, have - amount); }
          } else if (r < 0.85) {                            // somebody tries to transfer: always refused
            const to = holders[Math.floor(rnd() * holders.length)];
            await expect(f.icec.connect(who).transfer(to.address, 1n)).to.be.revertedWithCustomError(f.icec, 'NonTransferable');
          } else if (r < 0.93) {                            // a new day
            await time.increase(86400);
            const d = Math.floor((await time.latest()) / 86400);
            if (d !== day) { day = d; mintedToday = 0n; }
          } else {                                          // pause and resume around a mint attempt
            await f.icec.connect(f.guardian).pauseMint();
            await expect(f.icec.connect(f.operator).mint(who.address, 1n, id(`p${step}`))).to.be.revertedWithCustomError(f.icec, 'MintIsPaused');
            await f.icec.connect(f.owner).unpauseMint();
          }

          // invariants after every step
          expect(await f.icec.totalSupply()).to.equal(supply);
          let sum = 0n;
          for (const h of holders) {
            const b = await f.icec.balanceOf(h.address);
            expect(b).to.equal(bal.get(h.address));
            sum += b;
          }
          expect(sum).to.equal(supply);
        }
      });
    }
  });
});
