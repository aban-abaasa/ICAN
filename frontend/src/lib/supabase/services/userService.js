import { supabase } from '../client.js';

/**
 * User Service - Shared user operations across ICAN and FARM-AGENT
 * Provides unified access to user profiles for blockchain data preparation
 */

export const UserService = {
  /**
   * Get user profile by ID
   */
  async getProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching profile:', error);
      return { data: null, error };
    }
  },

  /**
   * Update user profile
   */
  async updateProfile(userId, updates) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { data: null, error };
    }
  },

  /**
   * Get all users (for blockchain sync)
   */
  async getAllUsers() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name, created_at, is_verified');

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching all users:', error);
      return { data: null, error };
    }
  }
};

export default UserService;
