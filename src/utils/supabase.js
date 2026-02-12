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

// ========================================
// СТАРЫЕ ФУНКЦИИ (для Telegram)
// ========================================

const buildTelegramEmail = (telegramUserId) => `telegram_${telegramUserId}@temp.com`;
const buildTelegramPassword = (telegramUserId) => `telegram_${telegramUserId}_auth`;
const isInvalidCredentialsError = (error) =>
  Boolean(
    error &&
    (error.message?.includes('Invalid login credentials') || error.code === 'invalid_credentials')
  );

const isUserAlreadyExistsError = (error) =>
  Boolean(
    error &&
    (error.message?.includes('User already registered') || error.code === 'user_already_exists')
  );

const getTelegramUserId = (telegramUser) => String(telegramUser?.id || '');
const getSessionTelegramId = (user) => String(user?.user_metadata?.telegram_id || '');
const getSessionEmail = (user) => String(user?.email || '').toLowerCase();
const isSessionMatchingTelegramUser = (user, telegramUser) => {
  const telegramUserId = getTelegramUserId(telegramUser);
  if (!telegramUserId) return true;

  const sessionTelegramId = getSessionTelegramId(user);
  if (sessionTelegramId && sessionTelegramId === telegramUserId) {
    return true;
  }

  // Backward compatibility: old Telegram users may not have telegram_id in metadata,
  // but they still have a deterministic Telegram email.
  return getSessionEmail(user) === buildTelegramEmail(telegramUserId);
};

// ========================================
// НОВЫЕ ФУНКЦИИ (для Phone Auth)
// ========================================

/**
 * Форматирование номера телефона
 * Приводит к формату: +79991234567
 */
const formatPhone = (phone) => {
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  if (cleaned.startsWith('8')) {
    cleaned = '+7' + cleaned.slice(1);
  }
  
  if (cleaned.startsWith('7') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  
  if (!cleaned.startsWith('+')) {
    cleaned = '+7' + cleaned;
  }
  
  return cleaned;
};

/**
 * Генерация email для phone auth
 */
const phoneToEmail = (phone) => {
  const cleaned = formatPhone(phone).replace(/\+/g, '');
  return `${cleaned}@babydiary.local`;
};

// ========================================
// AUTH HELPERS - ОБНОВЛЁННАЯ ВЕРСИЯ
// ========================================

export const authHelpers = {
  // ========================================
  // НОВЫЕ МЕТОДЫ: Phone Auth
  // ========================================

  /**
   * Регистрация через телефон и пароль
   */
  async signUpWithPhone(phone, password, fullName = '') {
    try {
      const formattedPhone = formatPhone(phone);
      const email = phoneToEmail(formattedPhone);

      console.log('📱 Регистрация:', { phone: formattedPhone, email });

      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            phone: formattedPhone,
            full_name: fullName,
            auth_method: 'phone',
          },
          emailRedirectTo: undefined,
        },
      });

      if (error) throw error;

      // Создаём профиль в user_profiles (если не создался триггером)
      if (data?.user) {
        await this._ensureUserProfile(data.user.id, formattedPhone, fullName);
      }

      console.log('✅ Регистрация успешна:', data);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Ошибка регистрации:', error);
      return { data: null, error };
    }
  },

  /**
   * Вход через телефон и пароль
   */
  async signInWithPhone(phone, password) {
    try {
      const formattedPhone = formatPhone(phone);
      const email = phoneToEmail(formattedPhone);

      console.log('🔐 Вход:', { phone: formattedPhone, email });

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) throw error;

      console.log('✅ Вход успешен:', data);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Ошибка входа:', error);
      return { data: null, error };
    }
  },

  /**
   * Привязка Telegram аккаунта к существующему пользователю
   */
  async linkTelegramAccount(telegramUser) {
    try {
      const user = await this.getCurrentUser();
      if (!user) {
        throw new Error('Пользователь не авторизован');
      }

      console.log('🔗 Привязка Telegram:', {
        userId: user.id,
        telegramId: telegramUser.id,
      });

      // Проверяем, не привязан ли уже этот Telegram аккаунт
      const { data: existing } = await supabase
        .from('user_telegram_mapping')
        .select('*')
        .eq('user_id', telegramUser.id)
        .maybeSingle();

      if (existing && existing.auth_user_id && existing.auth_user_id !== user.id) {
        throw new Error('Этот Telegram аккаунт уже привязан к другому пользователю');
      }

      // Создаём или обновляем связь
      const { data, error } = await supabase
        .from('user_telegram_mapping')
        .upsert({
          user_id: telegramUser.id,
          chat_id: telegramUser.id,
          username: telegramUser.username,
          auth_user_id: user.id,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        })
        .select()
        .single();

      if (error) throw error;

      console.log('✅ Telegram привязан:', data);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Ошибка привязки Telegram:', error);
      return { data: null, error };
    }
  },

  /**
   * Вход через Telegram (проверка привязки)
   */
  async checkTelegramLink(telegramUser) {
    try {
      console.log('📱 Проверка привязки Telegram:', telegramUser.id);

      // Ищем привязанный auth_user_id
      const { data: mapping, error: mappingError } = await supabase
        .from('user_telegram_mapping')
        .select('auth_user_id')
        .eq('user_id', telegramUser.id)
        .maybeSingle();

      if (mappingError || !mapping?.auth_user_id) {
        console.log('⚠️ Telegram аккаунт не привязан');
        return { 
          linked: false,
          authUserId: null,
        };
      }

      console.log('✅ Telegram привязан к:', mapping.auth_user_id);
      return {
        linked: true,
        authUserId: mapping.auth_user_id,
      };
    } catch (error) {
      console.error('❌ Ошибка проверки привязки:', error);
      return {
        linked: false,
        authUserId: null,
      };
    }
  },

  /**
   * Вспомогательная функция: создать профиль если не существует
   */
  async _ensureUserProfile(userId, phone, fullName) {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          id: userId,
          phone: phone,
          full_name: fullName,
        }, {
          onConflict: 'id',
        });

      if (error) throw error;
      console.log('✅ Профиль создан/обновлён');
    } catch (error) {
      console.error('❌ Ошибка создания профиля:', error);
    }
  },

  // ========================================
  // СТАРЫЕ МЕТОДЫ: Telegram Auth (сохранены)
  // ========================================

  async signInWithTelegram(telegramUser) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: buildTelegramEmail(telegramUser.id),
        password: buildTelegramPassword(telegramUser.id),
      });

      if (isInvalidCredentialsError(error)) {
        return await this.signUpWithTelegram(telegramUser);
      }

      if (error) throw error;

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
          emailRedirectTo: undefined,
        },
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      if (isUserAlreadyExistsError(error)) {
        return {
          data: null,
          error: new Error('Пользователь уже существует, но пароль Telegram-аккаунта устарел.'),
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

  /**
   * ОБНОВЛЁННАЯ функция: Универсальная инициализация сессии
   * Теперь с поддержкой phone auth
   */
  async ensureAuthenticatedSession({ telegramUser, platform } = {}) {
    console.log('🔄 Инициализация сессии:', { telegramUser: !!telegramUser, platform });

    // Проверяем существующую сессию
    const existingUser = await this.getCurrentUser();

    // Если есть Telegram данные
    if (telegramUser) {
      // Проверяем, привязан ли Telegram к phone auth аккаунту
      const linkCheck = await this.checkTelegramLink(telegramUser);
      
      if (linkCheck.linked && linkCheck.authUserId) {
        // Telegram привязан к phone auth - проверяем сессию
        if (existingUser && existingUser.id === linkCheck.authUserId) {
          console.log('✅ Активная сессия phone auth с привязкой Telegram');
          return { user: existingUser, mode: 'session', error: null };
        }
        
        // Сессии нет, но аккаунт привязан - требуется вход через телефон
        console.log('⚠️ Telegram привязан, но сессия отсутствует - требуется вход');
        return { user: null, mode: 'needs_login', error: null };
      }
      
      // Telegram НЕ привязан
      if (existingUser) {
        // Есть активная phone auth сессия - можем привязать Telegram
        const { error } = await this.linkTelegramAccount(telegramUser);
        if (!error) {
          console.log('✅ Telegram привязан к текущей phone auth сессии');
        }
        return { user: existingUser, mode: 'existing_session', error: null };
      }

      // Нет ни привязки, ни сессии - требуется регистрация
      console.log('⚠️ Telegram не привязан, сессии нет - требуется регистрация');
      return { user: null, mode: 'needs_registration', error: null };
    }

    // Если есть существующая сессия - используем её
    if (existingUser) {
      return { user: existingUser, mode: 'session', error: null };
    }

    // Нет ни Telegram, ни сессии - требуется вход
    console.log('⚠️ Требуется авторизация');
    return { user: null, mode: 'needs_auth', error: null };
  },

  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  async getUserProfile() {
    const user = await this.getCurrentUser();
    if (!user) return { data: null, error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    return { data, error };
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  },
};

// ========================================
// BABY HELPERS - БЕЗ ИЗМЕНЕНИЙ
// ========================================

export const babyHelpers = {
  async getProfile() {
    const user = await authHelpers.getCurrentUser();
    if (!user) return { data: null, error: 'Not authenticated' };
    
    const { data, error } = await supabase
      .from('babies')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    
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

// ========================================
// ACTIVITIES HELPERS - БЕЗ ИЗМЕНЕНИЙ
// ========================================

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

// ========================================
// GROWTH HELPERS - БЕЗ ИЗМЕНЕНИЙ
// ========================================

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

// ========================================
// SUBSCRIPTIONS - БЕЗ ИЗМЕНЕНИЙ
// ========================================

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