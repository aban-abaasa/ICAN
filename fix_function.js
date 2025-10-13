  const getIntelligentQuickActions = () => {
    const baseActions = [
      { emoji: '💰', text: 'Income 50000 salary', label: 'Salary' },
      { emoji: '🍽️', text: 'Expense 8000 lunch', label: 'Lunch' },
      { emoji: '🏍️', text: 'Expense 3000 boda transport', label: 'Transport' },
      { emoji: '💡', text: 'Expense 15000 electricity bill', label: 'Utilities' },
      { emoji: '⛪', text: 'Expense 25000 tithe offering', label: 'Tithe' },
      { emoji: '🏪', text: 'Income 150000 business sales', label: 'Business' }
    ];
    
    // Add intelligent loan recommendations based on current financial state
    if (netWorthTrend === 'growing' && netWorth > 1000000) {
      baseActions.push({
        emoji: '🚀', 
        text: `Loan ${Math.min(netWorth * 0.2, 3000000)} growth capital`, 
        label: 'Growth Loan',
        intelligent: true,
        tooltip: 'AI-suggested based on your growing net worth'
      });
    } else if (netWorthTrend === 'declining' && netWorth > 500000) {
      baseActions.push({
        emoji: '🛡️', 
        text: `Loan ${Math.min(netWorth * 0.1, 800000)} stabilization`, 
        label: 'Stability',
        intelligent: true,
        tooltip: 'AI-suggested for financial stabilization'
      });
    } else {
      baseActions.push({
        emoji: '💼', 
        text: 'Loan 2000000 business expansion', 
        label: 'Bus. Loan'
      });
    }
    
    // Add smart financial actions based on trends
    if (intelligentRecommendations.length > 0) {
      const topRec = intelligentRecommendations[0];
      if (topRec.type === 'investment') {
        baseActions.push({
          emoji: '📈',
          text: 'Income 500000 investment return',
          label: 'Invest',
          intelligent: true,
          tooltip: 'AI-suggested investment opportunity'
        });
      }
    }
    
    return baseActions;
  };