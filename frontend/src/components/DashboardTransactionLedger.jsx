import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Lock, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import ReceiptTally, { TruthBadge } from './ReceiptTally';
import { getProofStatus } from '../utils/transactionReceipt';
import { analyzeReceiptTruth } from '../utils/receiptTruth';
import {
  businessBreakdown,
  businessNameOf,
  filterByAccount,
  filterByDirection,
  groupByDay,
  isBusinessTx,
  isIncomeTx,
  sortNewestFirst,
  summarize,
} from '../utils/dashboardLedger';
import './dashboard-ledger-classic.css';

const PAGE_SIZE = 30;
const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];
const ACCOUNTS = [
  { id: 'all', label: 'All' },
  { id: 'business', label: 'Business' },
  { id: 'personal', label: 'Personal' },
];

const clockTime = (raw) => {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * The Dashboard's transaction ledger: the period's records as a classic account
 * statement, with an account / business filter, tap-to-filter totals, entries
 * grouped by day and "show more" paging. The exact business name is shown on
 * every business entry so several businesses can be told apart.
 */
export default function DashboardTransactionLedger({
  transactions,
  period,
  onPeriodChange,
  periodLabel,
  expanded,
  onToggle,
  headerStyle,
  formatCurrency,
  businessNames,
  truth,
  truthRows,
  showOnlyNoProof,
  onToggleNoProof,
  onOpenReceipt,
  onDelete,
  onRecord,
}) {
  const [direction, setDirection] = useState('all'); // 'all' | 'in' | 'out'
  const [account, setAccount] = useState('all'); // 'all' | 'business' | 'personal'
  const [businessKey, setBusinessKey] = useState(''); // '' = every business
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => { setVisible(PAGE_SIZE); }, [period]);

  const sorted = useMemo(() => sortNewestFirst(transactions), [transactions]);
  const breakdown = useMemo(() => businessBreakdown(sorted, businessNames), [sorted, businessNames]);
  const businessTotal = useMemo(() => sorted.filter(isBusinessTx).length, [sorted]);
  const personalTotal = sorted.length - businessTotal;
  // A chosen business that has no records in this period no longer applies.
  const activeBusiness = account === 'business' && breakdown.some((g) => g.key === businessKey) ? businessKey : '';

  const scoped = useMemo(
    () => filterByAccount(sorted, account, activeBusiness, businessNames),
    [sorted, account, activeBusiness, businessNames]
  );
  const totals = useMemo(() => summarize(scoped), [scoped]);
  // The receipt tally follows the account / business filter. With no filter it reuses
  // the period's analysis from the parent instead of sealing every row again.
  const tallyTruth = useMemo(() => (account === 'all' ? truth : analyzeReceiptTruth(scoped)), [account, truth, scoped]);
  const list = useMemo(() => {
    const byDirection = filterByDirection(scoped, direction);
    return showOnlyNoProof ? byDirection.filter((tx) => getProofStatus(tx) === 'system') : byDirection;
  }, [scoped, direction, showOnlyNoProof]);
  const groups = useMemo(
    () => (period === 'today'
      ? [{ key: 'today', label: null, net: 0, rows: list.slice(0, visible) }]
      : groupByDay(list, visible)),
    [list, visible, period]
  );

  const filtersActive = account !== 'all' || direction !== 'all' || showOnlyNoProof;
  const remaining = Math.max(0, list.length - visible);

  const pickAccount = (next) => {
    setAccount(next);
    if (next !== 'business') setBusinessKey('');
    setVisible(PAGE_SIZE);
  };
  const pickBusiness = (key) => {
    setAccount(key ? 'business' : account);
    setBusinessKey(key);
    setVisible(PAGE_SIZE);
  };
  const pickDirection = (next) => {
    setDirection((current) => (current === next ? 'all' : next));
    setVisible(PAGE_SIZE);
    if (!expanded) onToggle();
  };
  const clearFilters = () => {
    setDirection('all');
    setAccount('all');
    setBusinessKey('');
    setVisible(PAGE_SIZE);
    if (showOnlyNoProof) onToggleNoProof();
  };

  const accountCount = { all: sorted.length, business: businessTotal, personal: personalTotal };
  const openOnKey = (tx) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenReceipt(tx);
    }
  };

  return (
    <section className="dl" aria-label={`${periodLabel} transactions`}>
      <button type="button" className="dl-head" aria-expanded={expanded} onClick={onToggle} style={headerStyle}>
        <span className="dl-head-main">
          <span className="dl-eyebrow">Transaction ledger</span>
          <span className="dl-title">
            {periodLabel} Transactions
            {sorted.length > 0 && <span className="dl-count">{sorted.length}</span>}
          </span>
        </span>
        <ChevronDown className={`dl-chevron w-5 h-5 ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      <div className="dl-rule" aria-hidden="true" />

      <div className="dl-tabs" role="tablist" aria-label="Period">
        {PERIODS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={period === tab.id}
            className="dl-tab"
            onClick={() => onPeriodChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {sorted.length > 0 && (
        <>
          <div className="dl-seg" role="group" aria-label="Account">
            {ACCOUNTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="dl-seg-btn"
                aria-pressed={account === a.id}
                onClick={() => pickAccount(a.id)}
              >
                {a.label}<span className="dl-seg-n">{accountCount[a.id]}</span>
              </button>
            ))}
          </div>

          {breakdown.length > 1 && (
            <div className="dl-chips" role="group" aria-label="Business">
              <button
                type="button"
                className="dl-chip"
                aria-pressed={account === 'business' && !activeBusiness}
                onClick={() => pickBusiness('')}
              >
                All businesses
              </button>
              {breakdown.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className="dl-chip"
                  aria-pressed={activeBusiness === g.key}
                  onClick={() => pickBusiness(g.key)}
                  title={`${g.name} — ${formatCurrency(g.amount)}`}
                >
                  🏢 {g.name}<span className="dl-seg-n">{g.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="dl-strip cols-3">
            <button type="button" className={`dl-cell ${direction === 'in' ? 'is-on' : ''}`} aria-pressed={direction === 'in'} onClick={() => pickDirection('in')}>
              <span className="dl-label">Money in</span>
              <span className="dl-figure is-in">+{formatCurrency(totals.income)}</span>
            </button>
            <button type="button" className={`dl-cell ${direction === 'out' ? 'is-on' : ''}`} aria-pressed={direction === 'out'} onClick={() => pickDirection('out')}>
              <span className="dl-label">Money out</span>
              <span className="dl-figure is-out">−{formatCurrency(totals.expense)}</span>
            </button>
            <button type="button" className="dl-cell" aria-label="Net, show all" onClick={() => { setDirection('all'); setVisible(PAGE_SIZE); }}>
              <span className="dl-label">Net</span>
              <span className={`dl-figure ${totals.net >= 0 ? '' : 'is-out'}`}>
                {totals.net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(totals.net))}
              </span>
            </button>
          </div>
        </>
      )}

      {expanded && (
        <div className="mt-3">
          {sorted.length === 0 ? (
            <div className="dl-empty">
              <p>No transactions for {periodLabel.toLowerCase()} period</p>
              <button type="button" className="dl-btn" onClick={onRecord}>Record one</button>
            </div>
          ) : (
            <>
              <ReceiptTally
                truth={tallyTruth}
                formatCurrency={formatCurrency}
                onlyMissing={showOnlyNoProof}
                onToggleMissing={onToggleNoProof}
              />

              {filtersActive && (
                <div className="dl-filterbar">
                  <span>Showing {list.length} of {sorted.length}</span>
                  <button type="button" onClick={clearFilters}>Clear filters</button>
                </div>
              )}

              {list.length === 0 ? (
                <div className="dl-empty">
                  <p>Nothing matches these filters</p>
                  <button type="button" className="dl-btn" onClick={clearFilters}>Clear filters</button>
                </div>
              ) : (
                <div className="dl-ledger">
                  {groups.map((group) => (
                    <div key={group.key}>
                      {group.label && (
                        <div className="dl-day">
                          <span>{group.label}</span>
                          <span className={group.net >= 0 ? 'is-in' : 'is-out'}>
                            {group.net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(group.net))}
                          </span>
                        </div>
                      )}
                      {group.rows.map((tx) => {
                        const isIn = isIncomeTx(tx);
                        const isBiz = isBusinessTx(tx);
                        const bizName = isBiz ? businessNameOf(tx, businessNames) : null;
                        const emoji = tx.metadata?.categoryEmoji || tx.categoryEmoji || null;
                        const category = tx.metadata?.categoryName || tx.metadata?.category || null;
                        return (
                          <div
                            key={tx.id}
                            role="button"
                            tabIndex={0}
                            className={`dl-entry ${isIn ? 'is-in' : 'is-out'}`}
                            onClick={() => onOpenReceipt(tx)}
                            onKeyDown={openOnKey(tx)}
                          >
                            <span className="dl-medal" aria-hidden="true">
                              {emoji || (isIn ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />)}
                            </span>

                            <p className="dl-desc">{tx.description || 'Transaction'}</p>
                            <span className="dl-amt">{isIn ? '+' : '−'}{formatCurrency(Math.abs(tx.amount || 0))}</span>

                            <div className="dl-meta">
                              {isBiz ? (
                                <span className="dl-tag is-biz" title={bizName || 'Business'}>🏢 {bizName || 'Business'}</span>
                              ) : (
                                <span className="dl-tag is-me">Personal</span>
                              )}
                              {category && <span className="dl-cat">{category}</span>}
                              <TruthBadge row={truthRows?.get(tx)} tx={tx} />
                              <span className="dl-end">
                                <span className="dl-when">{clockTime(tx.created_at)}</span>
                                {tx.involves_two_accounts ? (
                                  <span
                                    className="dl-lock"
                                    title={tx.archived_at ? 'Archived — involves two accounts, never deleted' : 'Involves two accounts — can never be deleted'}
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onDelete(tx); }}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    className="dl-del"
                                    title="Delete"
                                    aria-label={`Delete ${tx.description || 'transaction'}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  {remaining > 0 && (
                    <div className="dl-foot">
                      <button type="button" className="dl-btn" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                        Show {Math.min(PAGE_SIZE, remaining)} more
                      </button>
                      <div className="mt-2">{remaining} remaining</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
