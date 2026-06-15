// Add this code AFTER line 528 in ICANWallet.jsx
// (right after the market data useEffect)

  // Load candlestick data when trade modal opens
  useEffect(() => {
    if (showTradeModal) {
      loadCandlestickData();
      // Refresh candlestick data every 7 seconds
      const interval = setInterval(loadCandlestickData, 7000);
      return () => clearInterval(interval);
    }
  }, [showTradeModal]);

  // Load candlestick data from database
  const loadCandlestickData = async () => {
    try {
      setCandleLoading(true);
      const supabase = getSupabaseClient();
      
      // Fetch latest 100 candlesticks
      const { data, error } = await supabase
        .from('ican_price_ohlc')
        .select('*')
        .order('open_time', { ascending: false })
        .limit(100);
      
      if (error) {
        console.error('Error loading candlesticks:', error);
        setCandleData([]);
        return;
      }
      
      if (data && data.length > 0) {
        // Format data for chart and reverse to chronological order
        const formatted = data.reverse().map(candle => ({
          timestamp: candle.open_time,
          time: new Date(candle.open_time).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
          }),
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
          close_time: candle.close_time
        }));
        
        setCandleData(formatted);
      } else {
        setCandleData([]);
      }
    } catch (error) {
      console.error('Failed to load candlestick data:', error);
      setCandleData([]);
    } finally {
      setCandleLoading(false);
    }
  };
