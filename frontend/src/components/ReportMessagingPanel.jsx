import React, { useState, useEffect, useCallback } from 'react';
import { Send, MessageSquare, Briefcase, Users, X, Plus, CheckCircle, Clock } from 'lucide-react';
import cmmsMessagingService from '../services/cmmsMessagingService';

/**
 * Report Messaging & Job Assignment Panel
 * Integrated component for sending messages and assigning jobs on reports
 */
const ReportMessagingPanel = ({ 
  reportId, 
  companyId, 
  userRole,
  currentUserId,
  userEmail 
}) => {
  // ============================================================
  // STATE MANAGEMENT
  // ============================================================
  
  const [messages, setMessages] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [companyUsers, setCompanyUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('messages'); // 'messages' or 'jobs'
  const [messageText, setMessageText] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobFormData, setJobFormData] = useState({
    assignedUserId: '',
    jobTitle: '',
    jobDescription: '',
    dueDate: '',
    priority: 'medium'
  });
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);

  // Check if user can assign jobs
  const canAssignJobs = ['admin', 'coordinator', 'supervisor'].includes(userRole);

  // ============================================================
  // LOAD DATA
  // ============================================================

  const loadMessages = useCallback(async () => {
    setIsLoadingMessages(true);
    try {
      const result = await cmmsMessagingService.getReportMessages(companyId, reportId);
      if (result.success) {
        setMessages(result.data || []);
      }
    } finally {
      setIsLoadingMessages(false);
    }
  }, [companyId, reportId]);

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const result = await cmmsMessagingService.getReportJobs(companyId, reportId);
      if (result.success) {
        setJobs(result.data || []);
      }
    } finally {
      setIsLoadingJobs(false);
    }
  }, [companyId, reportId]);

  const loadCompanyUsers = useCallback(async () => {
    try {
      const result = await cmmsMessagingService.getCompanyUsers(companyId);
      if (result.success) {
        setCompanyUsers(result.data || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  }, [companyId]);

  useEffect(() => {
    loadMessages();
    loadCompanyUsers();
  }, [loadMessages, loadCompanyUsers]);

  useEffect(() => {
    if (canAssignJobs) {
      loadJobs();
    }
  }, [loadJobs, canAssignJobs]);

  // Auto-refresh messages every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTab === 'messages') {
        loadMessages();
      } else if (activeTab === 'jobs' && canAssignJobs) {
        loadJobs();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeTab, loadMessages, loadJobs, canAssignJobs]);

  // ============================================================
  // MESSAGE HANDLERS
  // ============================================================

  const handleSendMessage = async () => {
    if (!messageText.trim()) {
      alert('Please enter a message');
      return;
    }

    setIsSending(true);
    try {
      const result = await cmmsMessagingService.sendReportMessage(
        companyId,
        reportId,
        messageText.trim(),
        selectedRecipient || null,
        'comment'
      );

      if (result.success) {
        setMessageText('');
        setSelectedRecipient('');
        await loadMessages();
      } else {
        alert(`Error: ${result.error}`);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (window.confirm('Delete this message?')) {
      const result = await cmmsMessagingService.deleteMessage(messageId);
      if (result.success) {
        await loadMessages();
      } else {
        alert(`Error: ${result.error}`);
      }
    }
  };

  const handleMarkAsRead = async (messageId) => {
    await cmmsMessagingService.markMessageAsRead(messageId);
    await loadMessages();
  };

  // ============================================================
  // JOB ASSIGNMENT HANDLERS
  // ============================================================

  const handleSubmitJob = async (e) => {
    e.preventDefault();

    if (!jobFormData.assignedUserId) {
      alert('Please select a user to assign');
      return;
    }

    if (!jobFormData.jobTitle.trim()) {
      alert('Please enter a job title');
      return;
    }

    setIsSubmittingJob(true);
    try {
      const result = await cmmsMessagingService.assignJobToUser(
        companyId,
        reportId,
        jobFormData.assignedUserId,
        jobFormData.jobTitle,
        jobFormData.jobDescription,
        jobFormData.dueDate || null,
        jobFormData.priority
      );

      if (result.success) {
        alert('✅ Job assigned successfully!');
        setJobFormData({
          assignedUserId: '',
          jobTitle: '',
          jobDescription: '',
          dueDate: '',
          priority: 'medium'
        });
        setShowJobForm(false);
        await loadJobs();
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } finally {
      setIsSubmittingJob(false);
    }
  };

  const handleUpdateJobStatus = async (jobId, newStatus) => {
    const result = await cmmsMessagingService.updateJobStatus(jobId, newStatus);
    if (result.success) {
      await loadJobs();
    } else {
      alert(`Error: ${result.error}`);
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (window.confirm('Delete this job assignment?')) {
      const result = await cmmsMessagingService.deleteJobAssignment(jobId);
      if (result.success) {
        await loadJobs();
      } else {
        alert(`Error: ${result.error}`);
      }
    }
  };

  // ============================================================
  // RENDER: MESSAGES TAB
  // ============================================================

  const renderMessagesTab = () => (
    <div className="space-y-4">
      {/* Messages List */}
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-h-96 overflow-y-auto p-4 space-y-3">
        {isLoadingMessages ? (
          <p className="text-gray-400 text-sm text-center py-4">Loading messages...</p>
        ) : messages.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No messages yet. Start the conversation!</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-3 rounded-lg border-l-4 ${
                msg.is_read
                  ? 'bg-slate-800 border-gray-600'
                  : 'bg-blue-500/10 border-blue-500'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {msg.sender_name || msg.sender_email}
                  </p>
                  {msg.recipient_name && (
                    <p className="text-xs text-gray-400">→ {msg.recipient_name}</p>
                  )}
                  <p className="text-sm text-gray-300 mt-1 break-words">{msg.message_text}</p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-gray-500">
                      {new Date(msg.created_at).toLocaleString()}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-slate-700 text-gray-300">
                      {msg.message_type}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteMessage(msg.id)}
                  className="text-red-400 hover:text-red-300 text-xs"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Message Input */}
      <div className="space-y-2 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Send to (optional)</label>
          <select
            value={selectedRecipient}
            onChange={(e) => setSelectedRecipient(e.target.value)}
            className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 focus:border-blue-500 outline-none"
          >
            <option value="">Broadcast to all</option>
            {companyUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.role})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-slate-700 text-white text-xs rounded px-2 py-2 border border-slate-600 focus:border-blue-500 outline-none resize-none"
            rows="3"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                handleSendMessage();
              }
            }}
          />
          <button
            onClick={handleSendMessage}
            disabled={isSending}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded px-3 py-2 font-semibold text-xs flex items-center gap-1 h-fit"
          >
            <Send className="w-3 h-3" />
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );

  // ============================================================
  // RENDER: JOBS TAB
  // ============================================================

  const renderJobsTab = () => (
    <div className="space-y-4">
      {/* Jobs List */}
      <div className="bg-slate-900 rounded-lg border border-slate-700 max-h-96 overflow-y-auto space-y-2 p-3">
        {isLoadingJobs ? (
          <p className="text-gray-400 text-sm text-center py-4">Loading jobs...</p>
        ) : jobs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No jobs assigned yet</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{job.job_title}</p>
                  <p className="text-xs text-gray-400">
                    👤 {job.cmms_users?.length > 0 && job.cmms_users[0]?.name}
                  </p>
                  {job.job_description && (
                    <p className="text-xs text-gray-300 mt-1">{job.job_description}</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <span className={`text-xs px-2 py-1 rounded font-semibold ${
                      job.priority === 'critical' ? 'bg-red-500/20 text-red-300' :
                      job.priority === 'high' ? 'bg-orange-500/20 text-orange-300' :
                      job.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-300' :
                      'bg-blue-500/20 text-blue-300'
                    }`}>
                      {job.priority}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded font-semibold ${
                      job.assignment_status === 'completed' ? 'bg-green-500/20 text-green-300' :
                      job.assignment_status === 'in_progress' ? 'bg-blue-500/20 text-blue-300' :
                      job.assignment_status === 'rejected' ? 'bg-red-500/20 text-red-300' :
                      'bg-gray-500/20 text-gray-300'
                    }`}>
                      {job.assignment_status}
                    </span>
                  </div>
                  {job.due_date && (
                    <p className="text-xs text-gray-400 mt-1">
                      📅 Due: {new Date(job.due_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {canAssignJobs && (
                  <div className="flex gap-1">
                    {job.assignment_status !== 'completed' && (
                      <button
                        onClick={() => handleUpdateJobStatus(job.id, 'completed')}
                        className="text-green-400 hover:text-green-300 text-xs"
                        title="Mark as completed"
                      >
                        ✓
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteJob(job.id)}
                      className="text-red-400 hover:text-red-300 text-xs"
                      title="Delete job"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Job Assignment Form */}
      {canAssignJobs && (
        <>
          {!showJobForm ? (
            <button
              onClick={() => setShowJobForm(true)}
              className="w-full bg-green-600 hover:bg-green-700 text-white rounded px-3 py-2 font-semibold text-xs flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Assign New Job
            </button>
          ) : (
            <form onSubmit={handleSubmitJob} className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 space-y-2">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-sm font-semibold text-white">Assign Job</h4>
                <button
                  type="button"
                  onClick={() => setShowJobForm(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Assign to User *</label>
                <select
                  value={jobFormData.assignedUserId}
                  onChange={(e) => setJobFormData({...jobFormData, assignedUserId: e.target.value})}
                  className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 focus:border-green-500 outline-none"
                  required
                >
                  <option value="">Select a user...</option>
                  {companyUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Job Title *</label>
                <input
                  type="text"
                  value={jobFormData.jobTitle}
                  onChange={(e) => setJobFormData({...jobFormData, jobTitle: e.target.value})}
                  placeholder="e.g., Fix Pump Motor"
                  className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 focus:border-green-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Description</label>
                <textarea
                  value={jobFormData.jobDescription}
                  onChange={(e) => setJobFormData({...jobFormData, jobDescription: e.target.value})}
                  placeholder="Job details..."
                  className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 focus:border-green-500 outline-none resize-none"
                  rows="2"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Due Date</label>
                  <input
                    type="date"
                    value={jobFormData.dueDate}
                    onChange={(e) => setJobFormData({...jobFormData, dueDate: e.target.value})}
                    className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 focus:border-green-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Priority</label>
                  <select
                    value={jobFormData.priority}
                    onChange={(e) => setJobFormData({...jobFormData, priority: e.target.value})}
                    className="w-full bg-slate-700 text-white text-xs rounded px-2 py-1 border border-slate-600 focus:border-green-500 outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingJob}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded px-2 py-2 font-semibold text-xs"
              >
                {isSubmittingJob ? 'Assigning...' : 'Assign Job'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );

  // ============================================================
  // RENDER: MAIN COMPONENT
  // ============================================================

  return (
    <div className="glass-card bg-slate-800/40 border border-slate-700">
      {/* Header Tabs */}
      <div className="flex gap-2 border-b border-slate-700 p-3">
        <button
          onClick={() => setActiveTab('messages')}
          className={`flex items-center gap-1 px-3 py-2 rounded text-sm font-semibold transition-colors ${
            activeTab === 'messages'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Messages
        </button>

        {canAssignJobs && (
          <button
            onClick={() => setActiveTab('jobs')}
            className={`flex items-center gap-1 px-3 py-2 rounded text-sm font-semibold transition-colors ${
              activeTab === 'jobs'
                ? 'bg-green-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            Jobs ({jobs.length})
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'messages' ? renderMessagesTab() : renderJobsTab()}
      </div>
    </div>
  );
};

export default ReportMessagingPanel;
