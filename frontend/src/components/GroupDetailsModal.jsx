/**
 * GroupDetailsModal - Shows group contributions, user balance, interest earned, and growth chart
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  TrendingUp,
  DollarSign,
  Percent,
  Users,
  Clock,
  BarChart3,
  Send,
  MessageCircle,
  Video
} from 'lucide-react';
import {
  getUserGroupContribution,
  getGroupTransactionHistory,
  getGroupMessages
} from '../services/trustService';
import ContributionModal from './ContributionModal';
import FinancialTracker from './FinancialTracker';
import GroupChatRoom from './GroupChatRoom';
import LiveBoardroom from './LiveBoardroom';

const GroupDetailsModal = ({ group, onClose }) => {
  const { user } = useAuth();
  const [userContribution, setUserContribution] = useState(0);
  const [userInterest, setUserInterest] = useState(0);
  const [groupTotal, setGroupTotal] = useState(0);
  const [interestRate, setInterestRate] = useState(0);
  const [perSecondGrowth, setPerSecondGrowth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [showContributionModal, setShowContributionModal] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview, financial, chat, boardroom

  useEffect(() => {
    loadGroupDetails();
  }, [group?.id, user?.id]);

  const loadGroupDetails = async () => {
    if (!group?.id || !user?.id) return;
    setLoading(true);
    try {
      // Get user's contribution to this group
      const contribution = await getUserGroupContribution(group.id, user.id);
      setUserContribution(contribution?.total_contributed || 0);
      setUserInterest(contribution?.interest_earned || 0);
      
      // Get group total (from group members)
      setGroupTotal(group.group_total || 0);
      
      // Get group interest rate (default 10% per annum)
      const rate = group.interest_rate || 10;
      setInterestRate(rate);
      
      // Calculate per-second growth
      // Annual rate / (365 * 24 * 60 * 60 seconds)
      const secondsPerYear = 365 * 24 * 60 * 60;
      const perSecond = (userContribution * (rate / 100)) / secondsPerYear;
      setPerSecondGrowth(perSecond);
      
      // Get transaction history
      const txHistory = await getGroupTransactionHistory(group.id, user.id);
      setTransactions(txHistory);
      
      // Get group messages
      const msgs = await getGroupMessages(group.id);
      setMessages(msgs);
      
      // Generate mock chart data
      generateChartData(userContribution, rate);
      
    } catch (error) {
      console.error('Error loading group details:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateChartData = (contribution, rate) => {
    // Generate 30-day chart data
    const data = [];
    let currentBalance = contribution;
    const dailyGrowth = (contribution * (rate / 100)) / 365;
    
    for (let i = 0; i < 30; i++) {
      currentBalance += dailyGrowth;
      data.push({
        day: i + 1,
        balance: parseFloat(currentBalance.toFixed(2))
      });
    }
    setChartData(data);
  };

  const maxBalance = Math.max(...chartData.map(d => d.balance || 0), userContribution);
  const minBalance = Math.min(...chartData.map(d => d.balance || 0), userContribution);
  const range = maxBalance - minBalance || 1;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-b from-slate-900 to-slate-800 rounded-xl max-w-4xl w-full border border-slate-700 flex flex-col max-h-[90vh]">
          {/* Header - Fixed */}
          <div className="flex-shrink-0 p-8 border-b border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-black text-white">{group.name}</h2>
                <p className="text-sm text-gray-400 mt-1">{group.description}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Tab Navigation - Fixed */}
          <div className="flex-shrink-0 flex gap-2 border-b border-slate-700 bg-slate-900/50 px-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-3 font-semibold transition-all whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              📊 Overview
            </button>
            <button
              onClick={() => setActiveTab('financial')}
              className={`px-4 py-3 font-semibold transition-all whitespace-nowrap ${
                activeTab === 'financial'
                  ? 'text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              💰 Financial
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-3 font-semibold transition-all whitespace-nowrap ${
                activeTab === 'chat'
                  ? 'text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              💬 Chat ({messages.length})
            </button>
            <button
              onClick={() => setActiveTab('boardroom')}
              className={`px-4 py-3 font-semibold transition-all whitespace-nowrap ${
                activeTab === 'boardroom'
                  ? 'text-white border-b-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              📹 Live Boardroom
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Your Contribution */}
                <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-400/30 rounded-lg p-4 hover:border-blue-400/60 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-gray-400">Your Contribution</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-300">
                    ${userContribution.toFixed(2)}
                  </div>
                </div>

                {/* Interest Earned */}
                <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-400/30 rounded-lg p-4 hover:border-green-400/60 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-gray-400">Interest Earned</span>
                  </div>
                  <div className="text-2xl font-bold text-green-300">
                    ${userInterest.toFixed(2)}
                  </div>
                </div>

                {/* Interest Rate */}
                <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/10 border border-purple-400/30 rounded-lg p-4 hover:border-purple-400/60 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <Percent className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-gray-400">Annual Rate</span>
                  </div>
                  <div className="text-2xl font-bold text-purple-300">
                    {interestRate}%
                  </div>
                </div>

                {/* Per Second Growth */}
                <div className="bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 border border-yellow-400/30 rounded-lg p-4 hover:border-yellow-400/60 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-gray-400">Growth/Second</span>
                  </div>
                  <div className="text-2xl font-bold text-yellow-300">
                    ${perSecondGrowth.toFixed(6)}
                  </div>
                </div>
              </div>

              {/* Group Stats */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-cyan-400" />
                    <div>
                      <p className="text-xs text-gray-400">Group Total</p>
                      <p className="text-lg font-bold text-cyan-300">${groupTotal.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Your Share</p>
                    <p className="text-lg font-bold text-cyan-300">
                      {((userContribution / (groupTotal || 1)) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Interest Growth Chart */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-lg font-bold text-white">30-Day Interest Growth</h3>
                </div>

                {chartData.length > 0 ? (
                  <div className="space-y-4">
                    {/* Chart */}
                    <div className="flex items-end gap-1 h-40 bg-slate-900 rounded p-4">
                      {chartData.map((point, idx) => {
                        const height = ((point.balance - minBalance) / range) * 100 || 0;
                        return (
                          <div
                            key={idx}
                            className="flex-1 bg-gradient-to-t from-emerald-500 to-emerald-400 rounded-t transition-all hover:opacity-70 hover:from-emerald-400 hover:to-emerald-300 group relative"
                            style={{ height: `${height}%`, minHeight: '4px' }}
                            title={`Day ${point.day}: $${point.balance.toFixed(2)}`}
                          >
                            <div className="hidden group-hover:block absolute -top-8 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap border border-emerald-400">
                              ${point.balance.toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Chart Labels */}
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Day 1: ${userContribution.toFixed(2)}</span>
                      <span>Day 30: ${chartData[chartData.length - 1]?.balance.toFixed(2)}</span>
                    </div>

                    {/* Daily Breakdown */}
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div className="bg-slate-900 rounded p-3">
                        <p className="text-xs text-gray-400">Daily Growth</p>
                        <p className="text-lg font-bold text-emerald-300">
                          ${((userContribution * (interestRate / 100)) / 365).toFixed(2)}
                        </p>
                      </div>
                      <div className="bg-slate-900 rounded p-3">
                        <p className="text-xs text-gray-400">Monthly Growth (approx)</p>
                        <p className="text-lg font-bold text-emerald-300">
                          ${((userContribution * (interestRate / 100)) / 12).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    No transaction history yet
                  </div>
                )}
              </div>

              {/* Contribute Button */}
              <button
                onClick={() => setShowContributionModal(true)}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
              >
                <DollarSign className="w-5 h-5" />
                Contribute Now
              </button>
            </div>
          )}

          {activeTab === 'financial' && (
            <FinancialTracker 
              groupId={group.id} 
              userId={user?.id}
              transactions={transactions}
            />
          )}

          {activeTab === 'chat' && (
            <div className="flex flex-col h-[500px]">
              <GroupChatRoom 
                groupId={group.id} 
                groupName={group.name}
              />
            </div>
          )}

          {activeTab === 'boardroom' && (
            <div className="flex flex-col h-full">
              <LiveBoardroom 
                groupId={group.id} 
                groupName={group.name}
                members={group.trust_group_members}
              />
            </div>
          )}
          </div>

          {/* Footer - Fixed */}
          <div className="flex-shrink-0 p-8 border-t border-slate-700 bg-slate-900/50">
            {activeTab === 'overview' && (
              <button
                onClick={() => setShowContributionModal(true)}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
              >
                <DollarSign className="w-5 h-5" />
                Contribute Now
              </button>
            )}
            
            {activeTab !== 'overview' && (
              <button
                onClick={onClose}
                className="w-full py-3 bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white rounded-lg font-semibold transition-all"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Contribution Modal */}
      {showContributionModal && (
        <ContributionModal
          group={group}
          onClose={() => setShowContributionModal(false)}
          onContributionSuccess={() => {
            loadGroupDetails();
            setShowContributionModal(false);
          }}
        />
      )}
    </>
  );
};

export default GroupDetailsModal;
