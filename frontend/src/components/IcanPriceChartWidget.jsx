import React, { useEffect, useState, useCallback } from 'react';
import { LineChart as LineChartIcon, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import CandlestickChart from './CandlestickChart';

// Format a raw ican_price_ohlc row into the shape CandlestickChart expects.
// Mirrors formatCandleRow in ICANWallet.jsx's Trade > Chart tab.
const formatCandleRow = (candle) => ({
  id: candle.id,
  timestamp: candle.open_time,
  time: new Date(candle.open_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  open: parseFloat(candle.open_price || 0),
  high: parseFloat(candle.high_price || 0),
  low: parseFloat(candle.low_price || 0),
  close: parseFloat(candle.close_price || 0),
  volume: parseFloat(candle.trading_volume || 0),
  open_price: candle.open_price,
  high_price: candle.high_price,
  low_price: candle.low_price,
  close_price: candle.close_price,
  trading_volume: candle.trading_volume,
  open_time: candle.open_time,
  close_time: candle.close_time,
});

// A real, live ICANera price chart — the same public.ican_price_ohlc feed
// and CandlestickChart used inside the wallet's Trade tab, but standalone so
// it can live directly on the main dashboard instead of behind a wallet
// panel. Self-contained: mount it anywhere, no props required.
const IcanPriceChartWidget = () => {
  const [candleData, setCandleData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  const loadCandlestickData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      try { await supabase.rpc('ican_ensure_current_candle'); } catch {}

      const { data, error } = await supabase
        .from('ican_price_ohlc')
        .select('*')
        .order('open_time', { ascending: false })
        .limit(100);

      if (error || !data) {
        setCandleData([]);
        return;
      }
      setCandleData(data.reverse().map(formatCandleRow));
    } catch {
      setCandleData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCandlestickData(true);
    const fallbackPoll = setInterval(() => loadCandlestickData(false), 30000);

    const channel = supabase
      .channel('dashboard_ican_price_ohlc:live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ican_price_ohlc' }, (payload) => {
        const incoming = formatCandleRow(payload.new);
        setCandleData((prev) => [...prev, incoming].slice(-100));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ican_price_ohlc' }, (payload) => {
        const incoming = formatCandleRow(payload.new);
        setCandleData((prev) => {
          const idx = prev.findIndex((c) => c.id === incoming.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = incoming;
          return next;
        });
      })
      .subscribe();

    return () => {
      clearInterval(fallbackPoll);
      supabase.removeChannel(channel);
    };
  }, [loadCandlestickData]);

  const latestClose = candleData.length ? candleData[candleData.length - 1].close : null;
  const firstOpen = candleData.length ? candleData[0].open : null;
  const changePct = latestClose != null && firstOpen ? ((latestClose - firstOpen) / firstOpen) * 100 : null;

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-3">
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center gap-2 px-1 hover:opacity-90 transition-opacity"
      >
        <LineChartIcon className="w-4 h-4 text-sky-400 shrink-0" />
        <p className="text-sm font-semibold text-white">ICANera price</p>
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">Live</span>
        <span className="ml-auto flex items-center gap-2">
          {latestClose != null && (
            <span className="text-xs font-semibold text-white">
              {latestClose.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              {changePct != null && (
                <span className={`ml-1 ${changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {isExpanded && (
        <div className="mt-2">
          <CandlestickChart candleData={candleData} loading={loading} showLivePrice orderPlacementEnabled={false} />
        </div>
      )}
    </div>
  );
};

export default IcanPriceChartWidget;
