/**
 * BusinessLoanCalculator — extracted from ICAN_Capital_Engine
 * Full business loan analysis: payments, cash flow, taxes, tithe, risk advisory
 *
 * Props:
 *   isOpen        {boolean}
 *   onClose       {() => void}
 *   preFilledAmount {string|number}  — pre-fill loan amount from voice/typed detection
 *   onAddLoan     {(loan) => void}   — called when user confirms a good loan
 */

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export const BusinessLoanCalculator = ({ isOpen, onClose, preFilledAmount = '', onAddLoan, preFilledRevenue = '', preFilledExpenses = '', registeredLoans = [] }) => {
  const [loanAmount, setLoanAmount]           = useState('');
  const [interestRate, setInterestRate]       = useState('18');
  const [loanTerm, setLoanTerm]               = useState('3');
  const [loanPurpose, setLoanPurpose]         = useState('business-expansion');
  const [monthlyRevenue, setMonthlyRevenue]   = useState('5000000');
  const [operatingExpenses, setOperatingExpenses] = useState('500000');
  const [employeeSalaries, setEmployeeSalaries]   = useState('800000');
  const [rentUtilities, setRentUtilities]     = useState('300000');
  const [marketingCosts, setMarketingCosts]   = useState('200000');
  const [inventoryCosts, setInventoryCosts]   = useState('1500000');
  const [businessType, setBusinessType]       = useState('retail');
  const [currentTaxRate, setCurrentTaxRate]   = useState('30');
  const [vatRate, setVatRate]                 = useState('18');
  const [payeDeductions, setPayeDeductions]   = useState('100000');
  const [existingDebts, setExistingDebts]     = useState('400000');
  const [tithePercentage, setTithePercentage] = useState('10');

  // Pre-fill amount + real financial data when opened
  useEffect(() => {
    if (isOpen) {
      if (preFilledAmount) {
        setLoanAmount(String(preFilledAmount));
        // Apply sensible defaults for the pre-filled amount
        const amt = parseFloat(String(preFilledAmount).replace(/,/g, '')) || 0;
        if (amt > 10_000_000) { setInterestRate('20'); setLoanTerm('5'); }
        else if (amt > 1_000_000) { setInterestRate('22'); setLoanTerm('3'); }
        else { setInterestRate('24'); setLoanTerm('2'); }
      }
      // Pre-fill real monthly revenue & expenses from VelocityEngine
      if (preFilledRevenue) setMonthlyRevenue(preFilledRevenue);
      if (preFilledExpenses) {
        // Split real expenses across the main cost buckets proportionally
        const totalExp = parseFloat(preFilledExpenses) || 0;
        setOperatingExpenses(String(Math.round(totalExp * 0.15)));
        setEmployeeSalaries(String(Math.round(totalExp * 0.35)));
        setRentUtilities(String(Math.round(totalExp * 0.12)));
        setMarketingCosts(String(Math.round(totalExp * 0.08)));
        setInventoryCosts(String(Math.round(totalExp * 0.20)));
        setExistingDebts(String(Math.round(totalExp * 0.10)));
      }
    }
    if (!isOpen) {
      // reset on close so next open is fresh
      setLoanAmount('');
      setMonthlyRevenue('5000000');
      setOperatingExpenses('500000');
      setEmployeeSalaries('800000');
      setRentUtilities('300000');
      setMarketingCosts('200000');
      setInventoryCosts('1500000');
      setPayeDeductions('100000');
      setExistingDebts('400000');
    }
  }, [isOpen, preFilledAmount, preFilledRevenue, preFilledExpenses]);

  // ── Core calculations ──────────────────────────────────────────────────────
  const calculate = () => {
    const principal  = parseFloat(loanAmount)       || 0;
    const rate       = (parseFloat(interestRate) || 0) / 100 / 12;
    const payments   = (parseFloat(loanTerm)     || 0) * 12;
    const rev        = parseFloat(monthlyRevenue)   || 0;
    const opex       = parseFloat(operatingExpenses)|| 0;
    const sal        = parseFloat(employeeSalaries) || 0;
    const rent       = parseFloat(rentUtilities)    || 0;
    const mkt        = parseFloat(marketingCosts)   || 0;
    const inv        = parseFloat(inventoryCosts)   || 0;
    const debt       = parseFloat(existingDebts)    || 0;
    const taxRate    = parseFloat(currentTaxRate)   || 30;
    const vat        = parseFloat(vatRate)          || 18;
    const paye       = parseFloat(payeDeductions)   || 0;
    const tithe      = parseFloat(tithePercentage)  || 10;

    if (principal === 0 || rate === 0 || payments === 0) {
      return { monthlyPayment: 0, totalInterest: 0, metrics: null };
    }

    const monthly   = (principal * rate * Math.pow(1 + rate, payments)) / (Math.pow(1 + rate, payments) - 1);
    const totalPaid = monthly * payments;
    const totalInterest = totalPaid - principal;

    const totalExpenses = opex + sal + rent + mkt + inv + debt + monthly;
    const grossProfit   = rev - opex - inv;
    const netBeforeTax  = grossProfit - sal - rent - mkt - debt - monthly;
    const vatOnSales    = rev * (vat / 100);
    const corpTax       = Math.max(0, netBeforeTax * (taxRate / 100));
    const netAfterTax   = netBeforeTax - corpTax;
    const titheAmt      = Math.max(0, netAfterTax * (tithe / 100));
    const finalNet      = netAfterTax - titheAmt;
    const debtRatio     = rev > 0 ? (monthly / rev) * 100 : 100;
    const profitMargin  = rev > 0 ? (finalNet / rev) * 100 : 0;
    const breakEven     = totalExpenses + vatOnSales + titheAmt;

    return {
      monthlyPayment: monthly,
      totalInterest,
      metrics: {
        rev, totalExpenses, grossProfit, netBeforeTax, netAfterTax, finalNet,
        vatOnSales, corpTax, paye, titheAmt, debtRatio, profitMargin, breakEven,
        totalTaxes: vatOnSales + corpTax + paye,
      }
    };
  };

  const { monthlyPayment, totalInterest, metrics } = calculate();

  // ── Risk advisory ──────────────────────────────────────────────────────────
  const getAdvice = () => {
    const hasData = loanAmount && interestRate && loanTerm && monthlyRevenue;
    if (!hasData) return { label: 'Fill in details for analysis', color: 'gray', icon: '📋' };
    const { debtRatio = 0, profitMargin = 0, finalNet = 0 } = metrics || {};
    const rate = parseFloat(interestRate) || 0;
    if (finalNet < 0)      return { label: '🚨 CRITICAL — Negative cash flow', color: 'red',    icon: '🚨', detail: 'Fix profitability before borrowing.' };
    if (debtRatio > 40)    return { label: '⛔ EXCESSIVE DEBT BURDEN',          color: 'red',    icon: '⛔', detail: 'Reduce loan amount or extend term.' };
    if (rate > 25)         return { label: '💸 PREDATORY RATE — Avoid',         color: 'red',    icon: '💸', detail: 'Seek better terms elsewhere.' };
    if (profitMargin < 5 || debtRatio > 25) return { label: '⚠️ PROCEED WITH CAUTION', color: 'yellow', icon: '⚠️', detail: 'Keep 3-6 months of payments in reserve.' };
    if (rate > 18)         return { label: '🟡 MODERATE RISK',                  color: 'yellow', icon: '🟡', detail: 'Shop around for a better rate.' };
    if (finalNet > monthlyPayment * 2 && debtRatio < 20 && profitMargin > 10)
                           return { label: '✅ EXCELLENT OPPORTUNITY',           color: 'green',  icon: '✅', detail: `Monthly tithe: UGX ${(metrics?.titheAmt||0).toLocaleString()}. Steward faithfully.` };
    return { label: '👍 RECOMMENDED', color: 'green', icon: '👍', detail: 'Maintain profit levels and have contingency plans.' };
  };
  const advice = getAdvice();

  const colorBg    = { green: 'bg-green-50 border-green-200', yellow: 'bg-yellow-50 border-yellow-200', red: 'bg-red-50 border-red-200', gray: 'bg-gray-50 border-gray-200' };
  const colorText  = { green: 'text-green-800', yellow: 'text-yellow-800', red: 'text-red-800', gray: 'text-gray-600' };

  const inputCls  = 'w-full px-3 py-2 bg-white text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm placeholder-gray-400';
  const selectCls = 'w-full px-3 py-2 bg-white text-gray-900 border-2 border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 text-sm font-medium cursor-pointer appearance-auto shadow-sm';
  const labelCls  = 'block text-xs font-semibold text-gray-700 mb-1';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-3 overflow-y-auto">
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl w-full max-w-4xl shadow-2xl my-4">
        {/* ── Header ── */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-600 rounded-t-2xl px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              💼 Business Loan Calculator
              {preFilledAmount && (
                <span className="text-xs bg-white/20 border border-white/30 text-white px-2 py-0.5 rounded-full">
                  🎙 Auto-filled
                </span>
              )}
            </h2>
            <p className="text-blue-100 text-xs mt-0.5">Smart business financing analysis — Uganda tax & tithe included</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition p-1">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Registered Loans Banner ── */}
          {registeredLoans.length > 0 && (
            <div className="lg:col-span-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-xs font-bold text-blue-700 mb-2">📋 Registered Loans ({registeredLoans.length}) — principal pre-loaded</p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {registeredLoans.map((loan, i) => (
                  <div key={loan.id || i} className="flex justify-between text-xs text-blue-800 bg-white rounded-lg px-3 py-1.5 border border-blue-100">
                    <span className="truncate mr-2">{loan.description || `Loan #${i + 1}`}</span>
                    <span className="font-semibold whitespace-nowrap">UGX {(parseFloat(loan.amount) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                ))}
              </div>
              {preFilledRevenue && (
                <p className="text-xs text-blue-600 mt-2">💰 Revenue &amp; expenses auto-filled from your real 30-day transactions.</p>
              )}
            </div>
          )}
          {!registeredLoans.length && preFilledRevenue && (
            <div className="lg:col-span-3 bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
              🟢 Revenue and expenses pre-filled from your real 30-day transaction data.
            </div>
          )}

          {/* ── Left: Inputs ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Loan Details */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 text-sm">💳 Loan Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className={labelCls}>Loan Amount (UGX)</label>
                  <input type="number" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} className={inputCls} placeholder="10,000,000" />
                </div>
                <div>
                  <label className={labelCls}>Interest Rate (% p.a.)</label>
                  <input type="number" value={interestRate} onChange={e => setInterestRate(e.target.value)} className={inputCls} placeholder="18" step="0.1" />
                </div>
                <div>
                  <label className={labelCls}>Loan Term (Years)</label>
                  <input type="number" value={loanTerm} onChange={e => setLoanTerm(e.target.value)} className={inputCls} placeholder="3" />
                </div>
                <div>
                  <label className={labelCls}>📌 Loan Purpose</label>
                  <select value={loanPurpose} onChange={e => setLoanPurpose(e.target.value)} className={selectCls}>
                    <option value="business-expansion">🏗️ Business Expansion</option>
                    <option value="equipment">⚙️ Equipment Purchase</option>
                    <option value="inventory">📦 Inventory Financing</option>
                    <option value="working-capital">💼 Working Capital</option>
                    <option value="real-estate">🏠 Real Estate Investment</option>
                    <option value="salary-advance">👥 Salary Advance</option>
                    <option value="other">📝 Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>🏢 Business Type</label>
                  <select value={businessType} onChange={e => setBusinessType(e.target.value)} className={selectCls}>
                    <option value="retail">🛒 Retail</option>
                    <option value="manufacturing">🏭 Manufacturing</option>
                    <option value="services">🤝 Services</option>
                    <option value="technology">💻 Technology / IT</option>
                    <option value="agriculture">🌾 Agriculture</option>
                    <option value="hospitality">🏨 Hospitality</option>
                    <option value="construction">🔨 Construction</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Business Financials */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-3 text-sm">📊 Monthly Business Financials</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>💰 Gross Monthly Revenue (UGX)</label>
                  <input type="number" value={monthlyRevenue} onChange={e => setMonthlyRevenue(e.target.value)} className={inputCls} placeholder="5,000,000" />
                </div>
                <div>
                  <label className={labelCls}>Operating Expenses</label>
                  <input type="number" value={operatingExpenses} onChange={e => setOperatingExpenses(e.target.value)} className={inputCls} placeholder="500,000" />
                </div>
                <div>
                  <label className={labelCls}>Employee Salaries</label>
                  <input type="number" value={employeeSalaries} onChange={e => setEmployeeSalaries(e.target.value)} className={inputCls} placeholder="800,000" />
                </div>
                <div>
                  <label className={labelCls}>Rent & Utilities</label>
                  <input type="number" value={rentUtilities} onChange={e => setRentUtilities(e.target.value)} className={inputCls} placeholder="300,000" />
                </div>
                <div>
                  <label className={labelCls}>Marketing Costs</label>
                  <input type="number" value={marketingCosts} onChange={e => setMarketingCosts(e.target.value)} className={inputCls} placeholder="200,000" />
                </div>
                <div>
                  <label className={labelCls}>Inventory / Materials</label>
                  <input type="number" value={inventoryCosts} onChange={e => setInventoryCosts(e.target.value)} className={inputCls} placeholder="1,500,000" />
                </div>
                <div>
                  <label className={labelCls}>Existing Monthly Debts</label>
                  <input type="number" value={existingDebts} onChange={e => setExistingDebts(e.target.value)} className={inputCls} placeholder="400,000" />
                </div>
              </div>
            </div>

            {/* Taxes & Tithe */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-3 text-sm">🏛️ Taxes & Tithe (Uganda)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Corporate Tax Rate (%)</label>
                  <input type="number" value={currentTaxRate} onChange={e => setCurrentTaxRate(e.target.value)} className={inputCls} placeholder="30" step="0.1" />
                </div>
                <div>
                  <label className={labelCls}>VAT Rate (%)</label>
                  <input type="number" value={vatRate} onChange={e => setVatRate(e.target.value)} className={inputCls} placeholder="18" step="0.1" />
                </div>
                <div>
                  <label className={labelCls}>PAYE (Monthly)</label>
                  <input type="number" value={payeDeductions} onChange={e => setPayeDeductions(e.target.value)} className={inputCls} placeholder="100,000" />
                </div>
                <div>
                  <label className={labelCls}>Tithe (%)</label>
                  <input type="number" value={tithePercentage} onChange={e => setTithePercentage(e.target.value)} className={inputCls} placeholder="10" step="0.1" />
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: Analysis ── */}
          <div className="space-y-3">

            {/* Loan Summary */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-800 mb-3 text-sm">📈 Loan Analysis</h3>
              <div className="space-y-2 text-sm">
                <Row label="Monthly Payment" value={`UGX ${monthlyPayment.toLocaleString(undefined,{maximumFractionDigits:0})}`} bold />
                <Row label="Total Interest" value={`UGX ${totalInterest.toLocaleString(undefined,{maximumFractionDigits:0})}`} red />
                <Row label="Total Repayment" value={`UGX ${(monthlyPayment*(parseFloat(loanTerm)||0)*12).toLocaleString(undefined,{maximumFractionDigits:0})}`} />
              </div>
            </div>

            {/* Cash Flow */}
            {metrics && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-3 text-sm">💰 Cash Flow</h3>
                <div className="space-y-2 text-sm">
                  <Row label="Gross Revenue"   value={`UGX ${(metrics.rev||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} green />
                  <Row label="Total Expenses"  value={`UGX ${(metrics.totalExpenses||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} red />
                  <Row label="Net Cash Flow"   value={`UGX ${(metrics.finalNet||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} bold color={metrics.finalNet>=0?'green':'red'} />
                </div>
              </div>
            )}

            {/* Taxes & Tithe */}
            {metrics && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-3 text-sm">🏛️ Tax & Tithe</h3>
                <div className="space-y-2 text-sm">
                  <Row label="VAT on Sales"   value={`UGX ${(metrics.vatOnSales||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} />
                  <Row label="Corporate Tax"  value={`UGX ${(metrics.corpTax||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} />
                  <Row label="Total Taxes"    value={`UGX ${(metrics.totalTaxes||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} red />
                  <Row label="Monthly Tithe"  value={`UGX ${(metrics.titheAmt||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} color="purple" bold />
                </div>
              </div>
            )}

            {/* Risk */}
            {metrics && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-3 text-sm">⚡ Risk Metrics</h3>
                <div className="space-y-2 text-sm">
                  <Row label="Debt Service Ratio" value={`${(metrics.debtRatio||0).toFixed(1)}%`} color={metrics.debtRatio>30?'red':'green'} />
                  <Row label="Profit Margin"       value={`${(metrics.profitMargin||0).toFixed(1)}%`} color={metrics.profitMargin<5?'red':'green'} />
                  <Row label="Break-even Revenue"  value={`UGX ${(metrics.breakEven||0).toLocaleString(undefined,{maximumFractionDigits:0})}`} />
                </div>
              </div>
            )}

            {/* Advisory */}
            <div className={`rounded-xl p-4 border-2 ${colorBg[advice.color] || colorBg.gray}`}>
              <p className={`font-bold text-sm mb-1 ${colorText[advice.color] || colorText.gray}`}>{advice.label}</p>
              {advice.detail && <p className="text-xs text-gray-600">{advice.detail}</p>}
            </div>

            {/* Add to portfolio */}
            {advice.color === 'green' && onAddLoan && (
              <button
                onClick={() => {
                  onAddLoan({
                    amount: parseFloat(loanAmount) || 0,
                    interestRate: parseFloat(interestRate) || 0,
                    term: parseFloat(loanTerm) || 0,
                    purpose: loanPurpose,
                    monthlyPayment,
                    date: new Date().toISOString().split('T')[0],
                  });
                  onClose();
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition active:scale-95 text-sm"
              >
                💼 Add to Loan Portfolio
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Small helper for analysis rows ──
const Row = ({ label, value, bold, green, red, color }) => {
  const cls =
    color === 'green' || green ? 'text-green-600' :
    color === 'red'   || red   ? 'text-red-600'   :
    color === 'purple'         ? 'text-purple-600' :
    'text-gray-800';
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500">{label}</span>
      <span className={`${cls} ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
    </div>
  );
};

export default BusinessLoanCalculator;
