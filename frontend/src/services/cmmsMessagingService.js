/**
 * CMMS Report Messaging & Job Assignment Service
 * Handles messaging between users on reports and job assignments
 * 
 * Features:
 * - Send messages/comments on reports
 * - Reply to messages (threading)
 * - Assign jobs to users
 * - Track job status (pending, accepted, in_progress, completed, rejected)
 * - Get unread messages
 * - Get assigned jobs
 */

import { supabase } from '../lib/supabase/client';

// ============================================================
// 1. MESSAGING FUNCTIONS
// ============================================================

/**
 * Send message on a report
 * @param {string} companyId - Company UUID
 * @param {string} reportId - Report UUID
 * @param {string} messageText - Message content
 * @param {string} recipientId - (Optional) Direct recipient UUID
 * @param {string} messageType - Type: 'comment', 'reply', 'assignment', 'status_update'
 */
export const sendReportMessage = async (companyId, reportId, messageText, recipientId = null, messageType = 'comment') => {
  try {
    const { data, error } = await supabase
      .rpc('fn_send_report_message', {
        p_company_id: companyId,
        p_report_id: reportId,
        p_message_text: messageText,
        p_recipient_id: recipientId,
        p_message_type: messageType
      });

    if (error) {
      console.error('Error sending message:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      data: data,
      message: 'Message sent successfully'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

/**
 * Get all messages for a report (threaded)
 */
export const getReportMessages = async (companyId, reportId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_get_report_messages', {
        p_company_id: companyId,
        p_report_id: reportId
      });

    if (error) {
      console.error('Error fetching messages:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }

    // Group messages by thread level for display
    const messages = Array.isArray(data) ? data : [];
    return {
      success: true,
      data: messages,
      stats: {
        totalMessages: messages.length,
        unreadMessages: messages.filter(m => !m.is_read).length
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * Mark message as read
 */
export const markMessageAsRead = async (messageId) => {
  try {
    const { error } = await supabase
      .from('cmms_report_messages')
      .update({ is_read: true })
      .eq('id', messageId);

    if (error) {
      console.error('Error marking message as read:', error);
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true,
      message: 'Message marked as read'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete a message
 */
export const deleteMessage = async (messageId) => {
  try {
    const { error } = await supabase
      .from('cmms_report_messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      console.error('Error deleting message:', error);
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true,
      message: 'Message deleted successfully'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get unread messages count for current user
 */
export const getUnreadMessageCount = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_report_messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_read', false);

    if (error) {
      console.error('Error fetching unread count:', error);
      return {
        success: false,
        count: 0
      };
    }

    return {
      success: true,
      count: data?.length || 0
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      count: 0
    };
  }
};

/**
 * Get all messages for current user (sent or received)
 */
export const getUserMessages = async (companyId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_get_user_messages', {
        p_company_id: companyId
      });

    if (error) {
      console.error('Error fetching user messages:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }

    const messages = Array.isArray(data) ? data : [];
    return {
      success: true,
      data: messages,
      stats: {
        totalMessages: messages.length,
        unreadMessages: messages.filter(m => !m.is_read).length
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

// ============================================================
// 2. JOB ASSIGNMENT FUNCTIONS
// ============================================================

/**
 * Assign a user to a job on a report
 * @param {string} companyId - Company UUID
 * @param {string} reportId - Report UUID
 * @param {string} assignedToUserId - User to assign to
 * @param {string} jobTitle - Job title
 * @param {string} jobDescription - Job details
 * @param {string} dueDate - Due date (YYYY-MM-DD)
 * @param {string} priority - Priority: low, medium, high, critical
 */
export const assignJobToUser = async (
  companyId,
  reportId,
  assignedToUserId,
  jobTitle,
  jobDescription = '',
  dueDate = null,
  priority = 'medium'
) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_assign_job', {
        p_company_id: companyId,
        p_report_id: reportId,
        p_assigned_to_user_id: assignedToUserId,
        p_job_title: jobTitle,
        p_job_description: jobDescription,
        p_due_date: dueDate,
        p_priority: priority
      });

    if (error) {
      console.error('Error assigning job:', error);
      return {
        success: false,
        error: error.message,
        data: null
      };
    }

    return {
      success: true,
      data: data,
      message: `Job "${jobTitle}" assigned successfully`
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

/**
 * Get all jobs assigned to current user
 */
export const getUserJobAssignments = async (companyId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_get_user_job_assignments', {
        p_company_id: companyId
      });

    if (error) {
      console.error('Error fetching assignments:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }

    const jobs = Array.isArray(data) ? data : [];
    return {
      success: true,
      data: jobs,
      stats: {
        totalJobs: jobs.length,
        pendingJobs: jobs.filter(j => j.assignment_status === 'pending').length,
        inProgressJobs: jobs.filter(j => j.assignment_status === 'in_progress').length,
        completedJobs: jobs.filter(j => j.assignment_status === 'completed').length
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * Update job assignment status
 */
export const updateJobStatus = async (assignmentId, newStatus) => {
  try {
    if (!['pending', 'accepted', 'in_progress', 'completed', 'rejected'].includes(newStatus)) {
      return {
        success: false,
        error: 'Invalid status. Must be: pending, accepted, in_progress, completed, rejected'
      };
    }

    const { data, error } = await supabase
      .from('cmms_job_assignments')
      .update({ 
        assignment_status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select();

    if (error) {
      console.error('Error updating job status:', error);
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true,
      data: data?.[0],
      message: `Job status updated to "${newStatus}"`
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get all jobs for a report (admin/coordinator/supervisor only)
 */
export const getReportJobs = async (companyId, reportId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_job_assignments')
      .select(`
        id,
        assigned_to_user_id,
        job_title,
        job_description,
        assignment_status,
        priority,
        due_date,
        assigned_by_user_id,
        created_at,
        cmms_users!assigned_to_user_id (name, email, role),
        cmms_users!assigned_by_user_id (name, email, role)
      `)
      .eq('report_id', reportId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching report jobs:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }

    return {
      success: true,
      data: data || [],
      stats: {
        totalJobs: data?.length || 0,
        pendingJobs: data?.filter(j => j.assignment_status === 'pending').length || 0,
        inProgressJobs: data?.filter(j => j.assignment_status === 'in_progress').length || 0,
        completedJobs: data?.filter(j => j.assignment_status === 'completed').length || 0
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * Delete a job assignment
 */
export const deleteJobAssignment = async (assignmentId) => {
  try {
    const { error } = await supabase
      .from('cmms_job_assignments')
      .delete()
      .eq('id', assignmentId);

    if (error) {
      console.error('Error deleting job assignment:', error);
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true,
      message: 'Job assignment deleted successfully'
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Get all company users (for assignment selection)
 */
export const getCompanyUsers = async (companyId) => {
  try {
    const { data, error } = await supabase
      .rpc('fn_get_company_users', {
        p_company_id: companyId
      });

    if (error) {
      console.error('Error fetching company users:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }

    return {
      success: true,
      data: data || [],
      stats: {
        totalUsers: data?.length || 0
      }
    };
  } catch (error) {
    console.error('Service error:', error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

export default {
  sendReportMessage,
  getReportMessages,
  markMessageAsRead,
  deleteMessage,
  getUnreadMessageCount,
  getUserMessages,
  assignJobToUser,
  getUserJobAssignments,
  updateJobStatus,
  getReportJobs,
  deleteJobAssignment,
  getCompanyUsers
};
