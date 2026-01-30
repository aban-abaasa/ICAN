/**
 * 💎 ICAN Portfolio Dashboard
 * Complete overview of ICAN holdings, value, and transactions
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import icanCoinService from '../../services/icanCoinService';
import icanCoinBlockchainService from '../../services/icanCoinBlockchainService';
import { CountryService } from '../../services/countryService';
import './IcanPortfolio.css';

export default function IcanPortfolio() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState('overview');
  const [priceHistory, setPriceHistory] = useState(null);
  const [period, setPeriod] = useState('24h');

  // Load portfolio data
  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        setLoading(true);
        setError('');

        // Get portfolio summary
        const portfolioData = await icanCoinService.getPortfolioSummary(user.id);
        setPortfolio(portfolioData);

        // Get market data
        const market = await icanCoinBlockchainService.getCurrentPrice();
        setMarketData(market);

        // Get transactions
        const txns = await icanCoinService.getTransactionHistory(user.id, 20);
        setTransactions(txns);

        // Get price history
        const history = await icanCoinBlockchainService.getPriceHistory(period);
        setPriceHistory(history);
      } catch (err) {
        setError('Failed to load portfolio data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (user?.id) {
      loadPortfolio();
    }
  }, [user, period]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const portfolioData = await icanCoinService.getPortfolioSummary(user.id);
      setPortfolio(portfolioData);

      const market = await icanCoinBlockchainService.getCurrentPrice();
      setMarketData(market);
    } catch (err) {
      setError('Failed to refresh data');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  const getTransactionIcon = (type) => {
    switch (type) {
      case 'purchase':
        return '💳';
      case 'sale':
        return '💰';
      case 'transfer_out':
        return '📤';
      case 'transfer_in':
        return '📥';
      case 'staking':
        return '🌾';
      case 'rewards':
        return '🎁';
      default:
        return '💎';
    }
  };

  const getTransactionLabel = (type) => {
    switch (type) {
      case 'purchase':
        return 'Bought ICAN';
      case 'sale':
        return 'Sold ICAN';
      case 'transfer_out':
        return 'Sent ICAN';
      case 'transfer_in':
        return 'Received ICAN';
      case 'staking':
        return 'Staked ICAN';
      case 'rewards':
        return 'Staking Rewards';
      default:
        return 'Transaction';
    }
  };

  if (loading) {
    return (
      <div className="portfolio-container">
        <div className="loading-spinner">
          <div className="spinner-circle"></div>
          Loading your ICAN portfolio...
        </div>
      </div>
    );
  }

  return (
    <div className="portfolio-container">
      {/* Header */}
      <div className="portfolio-header">
        <h1>💎 ICAN Portfolio</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-refresh"
        >
          {refreshing ? '⟳ Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="alert alert-error">
          ❌ {error}
        </div>
      )}

      {portfolio && (
        <>
          {/* Main Balance Card */}
          <div className="main-balance-card">
            <div className="balance-section">
              <div className="balance-label">Total ICAN Balance</div>
              <div className="balance-amount">{portfolio.icanBalance.toFixed(2)}</div>
              <div className="balance-unit">ICAN Coins</div>
            </div>

            <div className="value-section">
              <div className="value-label">Equivalent Value in {portfolio.currency}</div>
              <div className="value-amount">{portfolio.formatted}</div>
              <div className="value-details">
                @ {portfolio.marketPrice.toLocaleString()} UGX per ICAN
              </div>
            </div>

            <div className="change-section">
              <div className="change-label">24h Market Change</div>
              <div className={`change-value ${portfolio.percentageChange24h >= 0 ? 'positive' : 'negative'}`}>
                {portfolio.percentageChange24h >= 0 ? '📈' : '📉'}
                {Math.abs(portfolio.percentageChange24h).toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Currency Values */}
          <div className="currency-grid">
            <h3>Your ICAN Value in All Currencies</h3>
            <div className="currency-cards">
              {portfolio.allCurrencies && Object.entries(portfolio.allCurrencies).map(([currency, value]) => (
                <div key={currency} className="currency-card">
                  <div className="currency-code">{currency}</div>
                  <div className="currency-symbol">
                    {CountryService.getCurrencySymbol(
                      Object.keys(CountryService.COUNTRIES).find(
                        code => CountryService.getCurrencyCode(code) === currency
                      ) || 'US'
                    )}
                  </div>
                  <div className="currency-value">{value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs">
            <button
              className={`tab ${selectedTab === 'overview' ? 'active' : ''}`}
              onClick={() => setSelectedTab('overview')}
            >
              📊 Overview
            </button>
            <button
              className={`tab ${selectedTab === 'transactions' ? 'active' : ''}`}
              onClick={() => setSelectedTab('transactions')}
            >
              📜 Transaction History
            </button>
            <button
              className={`tab ${selectedTab === 'market' ? 'active' : ''}`}
              onClick={() => setSelectedTab('market')}
            >
              📈 Market Chart
            </button>
          </div>

          {/* Overview Tab */}
          {selectedTab === 'overview' && (
            <div className="tab-content">
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon">💰</div>
                  <div className="stat-label">Total Value</div>
                  <div className="stat-value">{portfolio.formatted}</div>
                  <div className="stat-subtext">{portfolio.currency}</div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">📍</div>
                  <div className="stat-label">Country</div>
                  <div className="stat-value">{portfolio.countryName}</div>
                  <div className="stat-subtext">{portfolio.countryCode}</div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">💵</div>
                  <div className="stat-label">Base Currency</div>
                  <div className="stat-value">{portfolio.currency}</div>
                  <div className="stat-subtext">{portfolio.currencySymbol}</div>
                </div>

                {marketData && (
                  <div className="stat-card">
                    <div className="stat-icon">📊</div>
                    <div className="stat-label">Market Cap</div>
                    <div className="stat-value">{(marketData.market_cap / 1000000).toFixed(1)}M</div>
                    <div className="stat-subtext">UGX</div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="action-buttons">
                <a href="/buy-ican" className="btn btn-primary">
                  💳 Buy ICAN
                </a>
                <a href="/sell-ican" className="btn btn-secondary">
                  💰 Sell ICAN
                </a>
                <a href="/transfer-ican" className="btn btn-tertiary">
                  🌍 Transfer ICAN
                </a>
                <a href="/stake-ican" className="btn btn-success">
                  🌾 Stake ICAN
                </a>
              </div>
            </div>
          )}

          {/* Transactions Tab */}
          {selectedTab === 'transactions' && (
            <div className="tab-content">
              {transactions.length > 0 ? (
                <div className="transactions-list">
                  {transactions.map((tx, index) => (
                    <div key={index} className={`transaction-item ${tx.type}`}>
                      <div className="tx-icon">{getTransactionIcon(tx.type)}</div>
                      <div className="tx-details">
                        <div className="tx-label">{getTransactionLabel(tx.type)}</div>
                        <div className="tx-date">
                          {new Date(tx.timestamp).toLocaleDateString()} {new Date(tx.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="tx-amount">
                        <div className="tx-ican">
                          {tx.type.includes('out') ? '-' : '+'}
                          {tx.ican_amount.toFixed(2)} ICAN
                        </div>
                        {tx.local_amount && (
                          <div className="tx-local">
                            {tx.local_amount.toLocaleString()} {tx.currency || portfolio.currency}
                          </div>
                        )}
                      </div>
                      <div className={`tx-status ${tx.status}`}>
                        {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
                  <p>No transactions yet</p>
                  <p>Start by buying or transferring ICAN coins</p>
                </div>
              )}
            </div>
          )}

          {/* Market Chart Tab */}
          {selectedTab === 'market' && (
            <div className="tab-content">
              <div className="period-selector">
                {['1h', '24h', '7d', '30d'].map((p) => (
                  <button
                    key={p}
                    className={`period-btn ${period === p ? 'active' : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {priceHistory && priceHistory.length > 0 ? (
                <div className="chart-display">
                  <div className="price-stats">
                    <div className="stat">
                      <span className="label">Current:</span>
                      <span className="value">{portfolio.marketPrice.toLocaleString()} UGX</span>
                    </div>
                    <div className="stat">
                      <span className="label">High:</span>
                      <span className="value">
                        {Math.max(...priceHistory.map(p => p.price_ugx)).toLocaleString()} UGX
                      </span>
                    </div>
                    <div className="stat">
                      <span className="label">Low:</span>
                      <span className="value">
                        {Math.min(...priceHistory.map(p => p.price_ugx)).toLocaleString()} UGX
                      </span>
                    </div>
                    <div className="stat">
                      <span className="label">Avg:</span>
                      <span className="value">
                        {(
                          priceHistory.reduce((a, p) => a + p.price_ugx, 0) / priceHistory.length
                        ).toLocaleString()} UGX
                      </span>
                    </div>
                  </div>

                  <div className="chart-container">
                    <p>📈 Price chart visualization would appear here</p>
                    <p>Higher resolution charts coming soon with Chart.js integration</p>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <p>Market data not available</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Info Section */}
      <div className="portfolio-info">
        <h3>📌 About Your ICAN Portfolio:</h3>
        <ul>
          <li>💎 Your ICAN coins represent real digital value in the ICAN ecosystem</li>
          <li>📈 Market price fluctuates based on supply and demand</li>
          <li>🌍 Your ICAN value is shown in all supported currencies automatically</li>
          <li>💰 Sell anytime to convert ICAN back to local currency</li>
          <li>🌾 Stake ICAN coins to earn yield rewards</li>
          <li>🔐 All transactions are recorded on the blockchain for transparency</li>
        </ul>
      </div>
    </div>
  );
}
