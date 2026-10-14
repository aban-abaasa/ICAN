import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { getBalance } from '../services/icanWalletService';
import { tradeSector, getMyHoldings, getMyFills } from '../services/sectorMarketService';
import { useSectorMarkets } from './useSectorMarkets';
import { makeRequestIdStore } from '../utils/tradeResult';
import {
  ICEC, quoteBuy, quoteSell, validateBuy, validateSell, sectorState, friendlySectorError,
  formatPrice, trim, floor8,
} from '../utils/sectorTradeRules';

// The logic of Sector Markets, separate from how it looks, so the wallet's screen (SectorMarketsPanel) and the public
// /icaneracoin page (PublicSectorMarkets) are two skins over ONE implementation of the trade flow. Nothing here invents
// money logic: the price, the fee and every check are the database's (public.ican_sector_trade); this previews, asks
// and reports.
//
//   useSectorBoard({ enabled })        the ten sectors, which one is open, and the live feed (works signed out)
//   useSectorTicket(board, userId)     the buy / sell ticket, the person's balance, holdings and recent trades

// The sectors and the selected sector's candles. `enabled` = false stops the polling (a section scrolled out of view
// does not need to keep asking), but the first load still happens, so the caller learns whether the feature exists.
export const useSectorBoard = ({ enabled = true } = {}) => {
  const [selected, setSelected] = useState(null);
  const feed = useSectorMarkets(selected, { enabled });
  const { sectors } = feed;

  // first load: open the first live sector, or the first one
  useEffect(() => {
    if (selected || !sectors.length) return;
    setSelected((sectors.find((s) => s.status === 'live') || sectors[0]).ticker);
  }, [sectors, selected]);

  return { selected, setSelected, ...feed };
};

const useMoneyWallet = (userId) => {
  const [wallet, setWallet] = useState(null); // { currency, balance, price } -- price = ICEC cost in that currency
  const load = useCallback(async () => {
    if (!userId) { setWallet(null); return; }
    try {
      const { data: info } = await supabase.rpc('get_my_ican_trading_info');
      const currency = info?.currency ? String(info.currency).toUpperCase() : null;
      const price = Number(info?.price_per_ican);
      if (!currency || currency === ICEC || !(price > 0)) { setWallet(null); return; }
      const { data } = await supabase.from('wallet_accounts').select('balance').eq('user_id', userId).eq('currency', currency).maybeSingle();
      setWallet(data ? { currency, balance: parseFloat(data.balance) || 0, price } : null);
    } catch {
      setWallet(null);
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  return [wallet, load];
};

export const useSectorTicket = (board, userId = null) => {
  const { selected, setSelected, sectors, tradingEnabled, feeBps, maxTradeIcec, refresh } = board;

  const [mode, setMode] = useState('buy');
  const [amount, setAmountRaw] = useState('');
  const [payWith, setPayWith] = useState(ICEC);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'err', text }

  const [icec, setIcec] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [fills, setFills] = useState([]);
  const [money, reloadMoney] = useMoneyWallet(userId);
  const requestIds = useRef(makeRequestIdStore('sector')).current;

  const refreshMine = useCallback(async () => {
    if (!userId) { setIcec(null); setHoldings([]); setFills([]); return; }
    try { const b = await getBalance(userId); setIcec(Number(b.ican) || 0); } catch { /* keep the last balance */ }
    try { setHoldings((await getMyHoldings()).holdings); } catch { /* keep the last list */ }
    try { setFills((await getMyFills(10)).fills); } catch { /* keep the last list */ }
    reloadMoney();
  }, [userId, reloadMoney]);

  useEffect(() => {
    refreshMine();
    if (!userId) return undefined;
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') refreshMine(); }, 30_000);
    return () => clearInterval(t);
  }, [userId, refreshMine]);

  // changing what is being traded cancels a half-made review; picking another sector or side clears the last message
  // (typing a new amount clears it too, in setAmount: it must NOT clear here, or the success message that follows
  // emptying the box after a trade would vanish at once)
  useEffect(() => { setReviewing(false); }, [selected, mode, payWith, amount]);
  useEffect(() => { setNotice(null); }, [selected, mode]);
  useEffect(() => { if (payWith !== ICEC && !money) setPayWith(ICEC); }, [money, payWith]);

  const sel = useMemo(() => sectors.find((s) => s.ticker === selected) || null, [sectors, selected]);
  const state = sectorState(sel, tradingEnabled);
  const price = sel?.price_icec != null ? Number(sel.price_icec) : null;
  const held = Number(holdings.find((h) => h.sector === selected)?.units) || 0;
  const num = Number(amount);

  // what the entered amount is worth in ICEC (a money wallet is converted at the coin's price in that currency)
  const inMoney = !!(payWith !== ICEC && money);
  const payIcec = mode === 'buy' ? (inMoney ? floor8(num / money.price) : num) : null;
  const balance = mode === 'buy' ? (inMoney ? money.balance : icec) : held;
  const buyQuote = mode === 'buy' ? quoteBuy({ amount: payIcec, price, feeBps }) : null;
  const sellQuote = mode === 'sell' ? quoteSell({ units: num, price, feeBps }) : null;
  const problem = !amount ? null
    : mode === 'buy'
      ? validateBuy({ amount: num, balance: Number.isFinite(balance) ? balance : undefined, payIcec, price, feeBps, maxTrade: maxTradeIcec })
      : validateSell({ units: num, held, price, feeBps, maxTrade: maxTradeIcec });
  const ready = !!userId && state.canTrade && price > 0 && num > 0 && !problem;
  const feePct = feeBps / 100;
  const proceedsIn = inMoney ? money.currency : ICEC;

  // typing a new amount clears the last message; only digits and one dot get in
  const setAmount = useCallback((raw) => {
    setNotice(null);
    setAmountRaw(String(raw).replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'));
  }, []);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    const requestId = requestIds.idFor(`${mode}|${selected}|${amount}|${payWith}`);
    const res = await tradeSector({ sector: selected, side: mode, amount: num, currency: payWith, requestId, expectedPrice: price, maxSlippagePct: 1 });
    setBusy(false);
    setReviewing(false);
    if (res.success) {
      requestIds.clear();
      setAmountRaw('');
      setNotice({
        kind: 'ok',
        text: res.side === 'buy'
          ? `Bought ${trim(res.units, 8)} ${res.sector} at ${formatPrice(res.priceIcec)} ICEC.`
          : `Sold ${trim(res.units, 8)} ${res.sector} for ${trim(res.payAmount ?? res.netIcec, 8)} ${res.payAmount != null ? payWith : 'ICEC'}.`,
      });
      refreshMine();
      refresh();
    } else {
      if (res.code === 'price_moved') refresh();
      setNotice({ kind: 'err', text: friendlySectorError(res) });
    }
  };

  // "Sell" on a holding: open that sector's sell ticket empty
  const startSell = useCallback((sector) => { setSelected(sector); setMode('sell'); setAmountRaw(''); }, [setSelected]);

  return {
    userId, mode, setMode, amount, setAmount, setAmountRaw, payWith, setPayWith, reviewing, setReviewing, busy, notice,
    icec, holdings, fills, money, sel, state, price, held, num, inMoney, payIcec, balance, buyQuote, sellQuote, problem, ready,
    feePct, proceedsIn, submit, startSell, refreshMine,
  };
};

export default useSectorTicket;
