// src/utils/supabase.js
import { createClient } from '@supabase/supabase-js';

// Replace these with your Supabase project credentials
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const isSupabaseConfigured =
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_ANON_KEY) &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const buildTelegramEmail = (telegramUserId) => `telegram_${telegramUserId}@temp.com`;
const buildTelegramPassword = (telegramUserId) => `telegram_${telegramUserId}_auth`;

// Authentication helpers
export const authHelpers = {
  // Sign in with Telegram user data
  async signInWithTelegram(telegramUser) {
  try {
    // Use Telegram user ID as unique identifier
    const { data, error } = await supabase.auth.signInWithPassword({
      email: buildTelegramEmail(telegramUser.id),
      password: buildTelegramPassword(telegramUser.id),
    });

    if (error && error.message.includes('Invalid login credentials')) {
      // User doesn't exist, create account
      return await this.signUpWithTelegram(telegramUser);
    }

    if (error) throw error;

    // ✅ КРИТИЧЕСКИ ВАЖНО: Обновить telegram_id если его нет в метаданных
    // Это исправляет существующих пользователей, у которых не был сохранён telegram_id
    if (data?.user && !data.user.user_metadata?.telegram_id) {
      console.log('🔧 Updating missing telegram_id for user:', data.user.id);
      
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          telegram_id: telegramUser.id,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name,
          username: telegramUser.username,
        }
      });
      
      if (updateError) {
        console.error('Failed to update telegram_id:', updateError);
      } else {
        console.log('✅ telegram_id updated successfully');
      }
    }

    return { data, error: null };
  } catch (error) {
    console.error('Sign in error:', error);
    return { data: null, error };
  }
},

  async signUpWithTelegram(telegramUser) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: buildTelegramEmail(telegramUser.id),
        password: buildTelegramPassword(telegramUser.id),
        options: {
          data: {
            telegram_id: telegramUser.id,
            first_name: telegramUser.first_name,
            last_name: telegramUser.last_name,
            username: telegramUser.username,
          },
          emailRedirectTo: undefined, // Don't send confirmation email
        },
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      if (error?.message?.includes('User already registered')) {
        return {
          data: null,
          error: new Error('Пользователь уже существует, но пароль Telegram-аккаунта устарел. Нужно сбросить пароль в Supabase для этого пользователя.'),
        };
      }

      console.error('Sign up error:', error);
      return { data: null, error };
    }
  },

  async signInAnonymously() {
    const { data, error } = await supabase.auth.signInAnonymously();
    return { data, error };
  },

  async ensureAuthenticatedSession({ telegramUser } = {}) {
    if (telegramUser) {
      const signInResult = await this.signInWithTelegram(telegramUser);
      if (signInResult.error) {
        return { user: null, mode: 'telegram', error: signInResult.error };
      }

      return { user: signInResult.data?.user ?? signInResult.data?.session?.user ?? null, mode: 'telegram', error: null };
    }

    const existingUser = await this.getCurrentUser();
    if (existingUser) {
      return { user: existingUser, mode: 'session', error: null };
    }

    const { data, error } = await this.signInAnonymously();
    if (error) {
      return { user: null, mode: 'anonymous', error };
    }

    return { user: data?.user ?? data?.session?.user ?? null, mode: 'anonymous', error: null };
  },

  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  },
};

// Baby profile helpers
export const babyHelpers = {
  async getProfile() {
  const user = await authHelpers.getCurrentUser();
  if (!user) return { data: null, error: 'Not authenticated' };
  
  const { data, error } = await supabase
    .from('babies')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle(); // ← ИЗМЕНИЛИ на maybeSingle()
  
  return { data, error };
},

  async createProfile(profile) {
    const user = await authHelpers.getCurrentUser();
    const { data, error } = await supabase
      .from('babies')
      .insert([{
        user_id: user.id,
        name: profile.name,
        birth_date: profile.birthDate,
        photo_url: profile.photo,
      }])
      .select()
      .single();
    
    return { data, error };
  },

  async updateProfile(profile) {
    const { data, error } = await supabase
      .from('babies')
      .update({
        name: profile.name,
        birth_date: profile.birthDate,
        photo_url: profile.photo,
      })
      .eq('user_id', (await authHelpers.getCurrentUser()).id)
      .select()
      .single();
    
    return { data, error };
  },

  async upsertProfile(profile) {
    const existing = await this.getProfile();
    if (existing.data) {
      return this.updateProfile(profile);
    } else {
      return this.createProfile(profile);
    }
  },
};

// Activities helpers
export const activityHelpers = {
  async getActivities(limit = 100) {
    const profile = await babyHelpers.getProfile();
    if (!profile.data) return { data: [], error: null };

    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('baby_id', profile.data.id)
      .order('start_time', { ascending: false })
      .limit(limit);
    
    return { data, error };
  },

  async createActivity(activity) {
    const profile = await babyHelpers.getProfile();
    if (!profile.data) return { data: null, error: 'No baby profile found' };

    const activityData = {
      baby_id: profile.data.id,
      type: activity.type,
      start_time: activity.startTime,
      end_time: activity.endTime,
      comment: activity.comment,
    };

    // Add type-specific fields
    if (activity.type === 'breastfeeding') {
      activityData.left_duration = activity.leftDuration;
      activityData.right_duration = activity.rightDuration;
    } else if (activity.type === 'bottle') {
      activityData.food_type = activity.foodType;
      activityData.amount = activity.amount;
    } else if (activity.type === 'diaper') {
      activityData.diaper_type = activity.diaperType;
    } else if (activity.type === 'medicine') {
      activityData.medicine_name = activity.medicineName;
    }

    const { data, error } = await supabase
      .from('activities')
      .insert([activityData])
      .select()
      .single();
    
    return { data, error };
  },

  async updateActivity(id, activity) {
    const updateData = {
      type: activity.type,
      start_time: activity.startTime,
      end_time: activity.endTime,
      comment: activity.comment,
    };

    // Add type-specific fields
    if (activity.type === 'breastfeeding') {
      updateData.left_duration = activity.leftDuration;
      updateData.right_duration = activity.rightDuration;
    } else if (activity.type === 'bottle') {
      updateData.food_type = activity.foodType;
      updateData.amount = activity.amount;
    } else if (activity.type === 'diaper') {
      updateData.diaper_type = activity.diaperType;
    } else if (activity.type === 'medicine') {
      updateData.medicine_name = activity.medicineName;
    }

    const { data, error } = await supabase
      .from('activities')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    return { data, error };
  },

  async deleteActivity(id) {
    const { error } = await supabase
      .from('activities')
      .delete()
      .eq('id', id);
    
    return { error };
  },
};

// Growth records helpers
export const growthHelpers = {
  async getRecords() {
    const profile = await babyHelpers.getProfile();
    if (!profile.data) return { data: [], error: null };

    const { data, error } = await supabase
      .from('growth_records')
      .select('*')
      .eq('baby_id', profile.data.id)
      .order('measurement_date', { ascending: true });
    
    return { data, error };
  },

  async createRecord(record) {
    const profile = await babyHelpers.getProfile();
    if (!profile.data) return { data: null, error: 'No baby profile found' };

    const { data, error } = await supabase
      .from('growth_records')
      .insert([{
        baby_id: profile.data.id,
        measurement_date: record.date,
        weight: record.weight,
        height: record.height,
      }])
      .select()
      .single();
    
    return { data, error };
  },

  async updateRecord(id, record) {
    const { data, error } = await supabase
      .from('growth_records')
      .update({
        measurement_date: record.date,
        weight: record.weight,
        height: record.height,
      })
      .eq('id', id)
      .select()
      .single();
    
    return { data, error };
  },

  async deleteRecord(id) {
    const { error } = await supabase
      .from('growth_records')
      .delete()
      .eq('id', id);
    
    return { error };
  },
};

// Real-time subscriptions
export const subscribeToActivities = (callback) => {
  return supabase
    .channel('activities_changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'activities' },
      callback
    )
    .subscribe();
};

export const subscribeToGrowthRecords = (callback) => {
  return supabase
    .channel('growth_records_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'growth_records' },
      callback
    )
    .subscribe();
};

// Optimized initial dashboard loading to avoid duplicated profile queries
export const appDataHelpers = {
  async getInitialData(limit = 100) {
    const profileResult = await babyHelpers.getProfile();

    if (!profileResult.data) {
      return {
        profile: profileResult,
        activities: { data: [], error: null },
        growth: { data: [], error: null },
      };
    }

    const babyId = profileResult.data.id;

    const [activities, growth] = await Promise.all([
      supabase
        .from('activities')
        .select('*')
        .eq('baby_id', babyId)
        .order('start_time', { ascending: false })
        .limit(limit),
      supabase
        .from('growth_records')
        .select('*')
        .eq('baby_id', babyId)
        .order('measurement_date', { ascending: true }),
    ]);

    return {
      profile: profileResult,
      activities,
      growth,
    };
  },
};
