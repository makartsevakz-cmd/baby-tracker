// src/utils/supabase.js
// Временная заглушка - замените на настоящий Supabase когда будет готово

console.warn('⚠️ Supabase не настроен. Используется localStorage.');

export const supabase = null;

export const authHelpers = {
  async signInWithTelegram() {
    return { data: null, error: new Error('Supabase not configured') };
  },
  async getCurrentUser() {
    return null;
  },
};

export const babyHelpers = {
  async getProfile() {
    return { data: null, error: null };
  },
  async upsertProfile() {
    return { data: null, error: null };
  },
};

export const activityHelpers = {
  async getActivities() {
    return { data: [], error: null };
  },
  async createActivity() {
    return { data: null, error: null };
  },
  async updateActivity() {
    return { data: null, error: null };
  },
  async deleteActivity() {
    return { error: null };
  },
};

export const growthHelpers = {
  async getRecords() {
    return { data: [], error: null };
  },
  async createRecord() {
    return { data: null, error: null };
  },
  async updateRecord() {
    return { data: null, error: null };
  },
  async deleteRecord() {
    return { error: null };
  },
};

export const subscribeToActivities = () => null;
export const subscribeToGrowthRecords = () => null;