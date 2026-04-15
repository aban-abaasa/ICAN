/**
 * Vercel cron endpoint for background report automation.
 * - Daily transaction archiving into financial_reports (income-statement with daily-archive tags)
 * - Weekly and monthly automated income statements
 *
 * Requires env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

const FINANCE_BRAIN_PILLARS = [
  'Corporate finance',
  'Investments',
  'International finance',
  'Financial institutions'
];

const REPORTS_TABLE = 'financial_reports';
const TX_TABLE = 'ican_transactions';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const getDayKey = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const getWeekKey = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const getMonthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const getTransactionKind = (tx) => {
  const candidates = [
    tx?.transaction_type,
    tx?.type,
    tx?.category,
    tx?.metadata?.reporting_bucket
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  const joined = candidates.join(' ');
  if (/income|credit|sale|sold|deposit|receive|topup|top_up|cash_in|dividend/.test(joined)) return 'income';
  if (/expense|debit|purchase|buy|bought|withdraw|cashout|cash_out|fee|cost/.test(joined)) return 'expense';
  if (/invest|investment|portfolio|share|stock|bond/.test(joined)) return 'investment';
  return 'other';
};

const buildFinancialData = (transactions, reportPeriod) => {
  const totals = transactions.reduce((acc, tx) => {
    const amount = Math.abs(toNumber(tx.amount));
    const kind = getTransactionKind(tx);

    if (kind === 'income') acc.income += amount;
    else if (kind === 'expense') acc.expenses += amount;
    else if (kind === 'investment') acc.investments += amount;

    return acc;
  }, { income: 0, expenses: 0, investments: 0 });

  return {
    totalIncome: totals.income,
    totalExpenses: totals.expenses,
    businessIncome: totals.income * 0.6,
    investmentIncome: totals.investments,
    capitalGains: Math.max(0, totals.income - totals.expenses) * 0.1,
    taxPaid: totals.income * 0.1,
    netWorth: totals.income - totals.expenses,
    revenue: totals.income,
    costOfGoodsSold: totals.expenses * 0.4,
    operatingExpenses: totals.expenses * 0.4,
    otherIncome: 0,
    otherExpenses: 0,
    taxExpense: totals.income * 0.1,
    reportPeriod,
    transactionCount: transactions.length
  };
};

const buildIncomeStatementReport = (financialData, options = {}) => {
  const {
    countryCode = 'UG',
    countryName = 'Uganda',
    currency = 'UGX',
    status = 'DRAFT',
    tags = [],
    metadata = {}
  } = options;

  const revenue = financialData.revenue || 0;
  const costOfGoodsSold = financialData.costOfGoodsSold || 0;
  const operatingExpenses = financialData.operatingExpenses || 0;
  const otherIncome = financialData.otherIncome || 0;
  const otherExpenses = financialData.otherExpenses || 0;
  const taxExpense = financialData.taxExpense || 0;
  const reportPeriod = financialData.reportPeriod || 'Monthly';

  const grossProfit = revenue - costOfGoodsSold;
  const operatingIncome = grossProfit - operatingExpenses;
  const incomeBeforeTax = operatingIncome + otherIncome - otherExpenses;
  const netIncome = incomeBeforeTax - taxExpense;
  const netProfitMargin = revenue > 0 ? (netIncome / revenue * 100).toFixed(2) : '0.00';

  return {
    dbRow: {
      report_type: 'income-statement',
      country: countryCode,
      status,
      tags,
      data: {
        id: `IS_${Date.now()}`,
        type: 'income-statement',
        reportPeriod,
        country: countryName,
        currency,
        revenue: {
          mainRevenue: revenue,
          otherRevenue: otherIncome,
          totalRevenue: revenue + otherIncome
        },
        costOfRevenue: {
          costOfGoodsSold,
          grossProfit,
          grossProfitMargin: `${((grossProfit / (revenue + otherIncome || 1)) * 100).toFixed(2)}%`
        },
        operatingExpenses: {
          totalOperatingExpenses: operatingExpenses,
          other: operatingExpenses
        },
        operatingIncome: {
          amount: operatingIncome,
          margin: `${((operatingIncome / (revenue + otherIncome || 1)) * 100).toFixed(2)}%`
        },
        taxes: {
          incomeBeforeTax,
          taxExpense,
          effectiveTaxRate: incomeBeforeTax > 0 ? `${((taxExpense / incomeBeforeTax) * 100).toFixed(2)}%` : '0%'
        },
        netIncome: {
          amount: netIncome,
          margin: `${netProfitMargin}%`
        },
        metrics: {
          operatingMargin: `${((operatingIncome / (revenue + otherIncome || 1)) * 100).toFixed(2)}%`,
          netProfitMargin,
          expenseRatio: `${((operatingExpenses / (revenue + otherIncome || 1)) * 100).toFixed(2)}%`
        },
        generatedDate: new Date().toISOString(),
        status,
        metadata: {
          ...metadata,
          financeBrainPillars: FINANCE_BRAIN_PILLARS
        }
      }
    }
  };
};

const supabaseRequest = async ({ url, serviceKey, path, method = 'GET', query, body, prefer = 'return=minimal' }) => {
  const endpoint = new URL(`${url}/rest/v1/${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      endpoint.searchParams.set(key, value);
    });
  }

  const response = await fetch(endpoint.toString(), {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return null;
};

const hasReportWithTags = async ({ url, serviceKey, userId, tags }) => {
  const tagsExpr = `{${tags.join(',')}}`;
  const data = await supabaseRequest({
    url,
    serviceKey,
    path: REPORTS_TABLE,
    query: {
      select: 'id',
      user_id: `eq.${userId}`,
      report_type: 'eq.income-statement',
      tags: `cs.${tagsExpr}`,
      limit: '1'
    }
  });

  return Array.isArray(data) && data.length > 0;
};

const insertReports = async ({ url, serviceKey, rows }) => {
  if (!rows.length) return;
  await supabaseRequest({
    url,
    serviceKey,
    path: REPORTS_TABLE,
    method: 'POST',
    body: rows,
    prefer: 'return=representation'
  });
};

const groupTransactionsByUser = (transactions) => transactions.reduce((acc, tx) => {
  if (!tx?.user_id) return acc;
  if (!acc[tx.user_id]) acc[tx.user_id] = [];
  acc[tx.user_id].push(tx);
  return acc;
}, {});

const filterTransactionsInRange = (transactions, start, end) => transactions.filter((tx) => {
  const d = toDate(tx.created_at);
  if (!d) return false;
  return d >= start && d <= end;
});

const getTodayUTCStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
};

const buildDailyArchiveItems = (transactions) => transactions.map((tx) => ({
  id: tx.id || null,
  created_at: tx.created_at || null,
  transaction_type: tx.transaction_type || 'unknown',
  amount: toNumber(tx.amount),
  currency: tx.currency || 'UGX',
  description: tx.description || '',
  category: tx.category || tx.metadata?.category || null,
  metadata: tx.metadata || {}
}));

const processUserReports = async ({ url, serviceKey, userId, transactions, mode = 'all' }) => {
  const outputs = [];
  const todayStart = getTodayUTCStart();
  const now = new Date();

  if (mode === 'all' || mode === 'weekly' || mode === 'monthly') {
    if (mode === 'all' || mode === 'weekly') {
      const weeklyStart = new Date(todayStart);
      weeklyStart.setUTCDate(weeklyStart.getUTCDate() - 6);
      const weeklyTx = filterTransactionsInRange(transactions, weeklyStart, now);
      if (weeklyTx.length) {
        const weeklyKey = getWeekKey(now);
        const weeklyTags = ['auto', 'weekly', weeklyKey];
        const weeklyExists = await hasReportWithTags({ url, serviceKey, userId, tags: weeklyTags });
        if (!weeklyExists) {
          const financialData = buildFinancialData(weeklyTx, 'Weekly');
          const { dbRow } = buildIncomeStatementReport(financialData, {
            status: 'DRAFT',
            tags: weeklyTags,
            metadata: {
              automation: true,
              generatedFor: 'weekly',
              periodKey: weeklyKey,
              periodStart: weeklyStart.toISOString(),
              periodEnd: now.toISOString(),
              transactionCount: weeklyTx.length
            }
          });
          await insertReports({ url, serviceKey, rows: [{ user_id: userId, ...dbRow, created_at: new Date().toISOString() }] });
          outputs.push({ period: 'weekly', status: 'generated', key: weeklyKey });
        } else {
          outputs.push({ period: 'weekly', status: 'skipped-existing', key: weeklyKey });
        }
      }
    }

    if (mode === 'all' || mode === 'monthly') {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      const monthlyTx = filterTransactionsInRange(transactions, monthStart, now);
      if (monthlyTx.length) {
        const monthKey = getMonthKey(now);
        const monthTags = ['auto', 'monthly', monthKey];
        const monthlyExists = await hasReportWithTags({ url, serviceKey, userId, tags: monthTags });
        if (!monthlyExists) {
          const financialData = buildFinancialData(monthlyTx, 'Monthly');
          const { dbRow } = buildIncomeStatementReport(financialData, {
            status: 'DRAFT',
            tags: monthTags,
            metadata: {
              automation: true,
              generatedFor: 'monthly',
              periodKey: monthKey,
              periodStart: monthStart.toISOString(),
              periodEnd: now.toISOString(),
              transactionCount: monthlyTx.length
            }
          });
          await insertReports({ url, serviceKey, rows: [{ user_id: userId, ...dbRow, created_at: new Date().toISOString() }] });
          outputs.push({ period: 'monthly', status: 'generated', key: monthKey });
        } else {
          outputs.push({ period: 'monthly', status: 'skipped-existing', key: monthKey });
        }
      }
    }
  }

  if (mode === 'all' || mode === 'daily') {
    const groupedByDay = transactions.reduce((acc, tx) => {
      const d = toDate(tx.created_at);
      if (!d) return acc;
      const dayKey = getDayKey(d);
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(tx);
      return acc;
    }, {});

    const todayKey = getDayKey(todayStart);
    const dayKeys = Object.keys(groupedByDay).filter((k) => k < todayKey).sort();

    for (const dayKey of dayKeys) {
      const tags = ['auto', 'daily-archive', dayKey];
      const exists = await hasReportWithTags({ url, serviceKey, userId, tags });
      if (exists) {
        outputs.push({ period: 'daily-archive', status: 'skipped-existing', key: dayKey });
        continue;
      }

      const dayTx = groupedByDay[dayKey] || [];
      if (!dayTx.length) {
        outputs.push({ period: 'daily-archive', status: 'skipped-no-transactions', key: dayKey });
        continue;
      }

      const financialData = buildFinancialData(dayTx, 'Daily');
      const { dbRow } = buildIncomeStatementReport(financialData, {
        status: 'ARCHIVED',
        tags,
        metadata: {
          archiveType: 'daily-transactions',
          dayKey,
          transactionCount: dayTx.length,
          dailyTransactionItems: buildDailyArchiveItems(dayTx)
        }
      });

      await insertReports({ url, serviceKey, rows: [{ user_id: userId, ...dbRow, created_at: new Date().toISOString() }] });
      outputs.push({ period: 'daily-archive', status: 'archived', key: dayKey });
    }
  }

  return outputs;
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase automation environment variables' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const providedSecret = req.query.secret || req.headers['x-automation-secret'];
  const configuredSecret = process.env.REPORT_AUTOMATION_SECRET;

  if (!isVercelCron && configuredSecret && providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const mode = ['all', 'daily', 'weekly', 'monthly'].includes(String(req.query.mode || 'all'))
    ? String(req.query.mode || 'all')
    : 'all';

  try {
    const lookback = Number(req.query.lookbackDays || 95);
    const lookbackStart = new Date();
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - (Number.isFinite(lookback) ? Math.max(7, lookback) : 95));

    const transactions = await supabaseRequest({
      url,
      serviceKey,
      path: TX_TABLE,
      query: {
        select: 'id,user_id,amount,currency,transaction_type,description,category,created_at,metadata,status',
        created_at: `gte.${lookbackStart.toISOString()}`,
        status: 'neq.cancelled',
        order: 'created_at.asc',
        limit: '10000'
      }
    });

    const groupedUsers = groupTransactionsByUser(Array.isArray(transactions) ? transactions : []);
    const userIds = Object.keys(groupedUsers);

    const result = {
      mode,
      usersProcessed: 0,
      usersWithTransactions: userIds.length,
      generated: 0,
      archived: 0,
      skipped: 0,
      details: []
    };

    for (const userId of userIds) {
      const userResult = await processUserReports({
        url,
        serviceKey,
        userId,
        transactions: groupedUsers[userId] || [],
        mode
      });

      result.usersProcessed += 1;
      result.generated += userResult.filter((r) => r.status === 'generated').length;
      result.archived += userResult.filter((r) => r.status === 'archived').length;
      result.skipped += userResult.filter((r) => String(r.status).startsWith('skipped')).length;
      result.details.push({ userId, items: userResult });
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('Report automation failed:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
