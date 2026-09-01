/**
 * 📌 IcanEra Booking (Limit Order) Service
 * Lets a user queue a buy/sell at a target price instead of executing it
 * immediately, then auto-fills it through the same buy/sell code path as a
 * manual trade once the live fair price crosses that target.
 *
 * No server-side matching engine: fills are checked client-side whenever
 * this is polled (see icanOrderService.tryFillOpenOrders), the same way
 * the live candle feed only updates while a session is connected.
 */

import { supabase } from '../lib/supabase/client';
import { CountryService } from './countryService';
import icanCoinService from './icanCoinService';
import icanCoinBlockchainService from './icanCoinBlockchainService';

export const icanOrderService = {
  async createOrder({ userId, orderType, icanAmount, targetPriceUgx, countryCode }) {
    if (!userId) throw new Error('Missing userId');
    if (!['buy', 'sell'].includes(orderType)) throw new Error('Invalid order type');
    if (!(icanAmount > 0)) throw new Error('Amount must be greater than 0');
    if (!(targetPriceUgx > 0)) throw new Error('Target price must be greater than 0');

    const { data, error } = await supabase
      .from('ican_coin_orders')
      .insert([{
        user_id: userId,
        order_type: orderType,
        ican_amount: icanAmount,
        target_price_ugx: targetPriceUgx,
        country_code: countryCode || 'UG',
        status: 'open',
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getOpenOrders(userId) {
    if (!userId) return [];
    const { data, error } = await supabase
      .from('ican_coin_orders')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load booked orders:', error);
      return [];
    }
    return data || [];
  },

  async cancelOrder(orderId, userId) {
    const { error } = await supabase
      .from('ican_coin_orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('user_id', userId)
      .eq('status', 'open');

    if (error) throw error;
    return true;
  },

  /**
   * Execute one order for real (buy/sell flow, real wallet debit/credit,
   * real ican_coin_transactions row) at the given live price, then mark it
   * filled. Shared by the auto-fill check and by a user manually choosing
   * "Fill Now" on a booked order from the chart.
   */
  async _executeOrderFill(order, userId, priceUGX) {
    let result;
    if (order.order_type === 'buy') {
      const localAmount = CountryService.icanToLocal(
        parseFloat(order.ican_amount),
        order.country_code,
        priceUGX
      );
      result = await icanCoinService.buyIcanCoins(userId, localAmount, order.country_code, 'booked_order');
    } else {
      result = await icanCoinService.sellIcanCoins(userId, parseFloat(order.ican_amount), order.country_code);
    }

    if (result?.success) {
      const { error: updateError } = await supabase
        .from('ican_coin_orders')
        .update({
          status: 'filled',
          filled_at: new Date().toISOString(),
          filled_price_ugx: priceUGX,
          filled_transaction_id: result.transaction?.id || null,
        })
        .eq('id', order.id)
        .eq('user_id', userId)
        .eq('status', 'open');

      if (updateError) console.error('Order executed but failed to mark filled:', updateError);
    }

    return result;
  },

  /**
   * Check every open order this user has against the live fair price and
   * fill any that have crossed their target. Returns the orders that were
   * filled this pass.
   */
  async tryFillOpenOrders(userId) {
    const orders = await this.getOpenOrders(userId);
    if (orders.length === 0) return [];

    let priceUGX;
    try {
      const priceData = await icanCoinBlockchainService.getCurrentPrice();
      priceUGX = priceData.priceUGX;
    } catch (err) {
      console.error('Failed to fetch live price for order matching:', err);
      return [];
    }
    if (!priceUGX || priceUGX <= 0) return [];

    const filled = [];

    for (const order of orders) {
      const target = parseFloat(order.target_price_ugx);
      const shouldFill = order.order_type === 'buy' ? priceUGX <= target : priceUGX >= target;
      if (!shouldFill) continue;

      try {
        const result = await this._executeOrderFill(order, userId, priceUGX);
        if (result?.success) filled.push(order);
      } catch (err) {
        console.error(`Failed to auto-fill booked ${order.order_type} order ${order.id}:`, err);
      }
    }

    return filled;
  },

  /**
   * User-initiated: execute a specific booked order right now at the
   * current live price, regardless of whether it has actually crossed the
   * order's target yet — the equivalent of turning a resting limit order
   * into an immediate market order.
   */
  async fillOrderNow(order, userId) {
    const priceData = await icanCoinBlockchainService.getCurrentPrice();
    const priceUGX = priceData.priceUGX;
    if (!priceUGX || priceUGX <= 0) throw new Error('Could not read the live price');
    return this._executeOrderFill(order, userId, priceUGX);
  },
};

export default icanOrderService;
