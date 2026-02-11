import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Baby, Milk, Moon, Bath, Wind, Droplets, Pill, BarChart3, ArrowLeft, Play, Pause, Edit2, Trash2, X, Bell, Activity, Undo2 } from 'lucide-react';
import * as supabaseModule from './utils/supabase.js';
import cacheService, { CACHE_TTL_SECONDS } from './services/cacheService.js';
import notificationService from './services/notificationService.js';
const NotificationsView = lazy(() => import('./components/NotificationsView.jsx'));

const ActivityTracker = () => {
  const [activities, setActivities] = useState([]);
  const [view, setView] = useState('main');
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [timers, setTimers] = useState({});
  const [pausedTimers, setPausedTimers] = useState({});
  const [timerMeta, setTimerMeta] = useState({});
  const [formData, setFormData] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [tg, setTg] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [babyProfile, setBabyProfile] = useState({
    name: '',
    birthDate: '',
    photo: null
  });
  const [growthData, setGrowthData] = useState([]); // Array of {date, weight, height}
  const [profileForm, setProfileForm] = useState({ name: '', birthDate: '', photo: null });
  const [growthForm, setGrowthForm] = useState({ date: '', weight: '', height: '' });
  const [editingGrowthId, setEditingGrowthId] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [isSaving, setIsSaving] = useState(false); // Prevent double saves
  const [isSavingProfile, setIsSavingProfile] = useState(false); // Profile save state
  const [isSavingGrowth, setIsSavingGrowth] = useState(false); // Growth save state
  const [notificationHelpers, setNotificationHelpers] = useState(null);

  const activityTypes = {
    breastfeeding: { icon: Baby, label: 'Кормление грудью', color: 'bg-pink-100 text-pink-600' },
    bottle: { icon: Milk, label: 'Бутылочка', color: 'bg-blue-100 text-blue-600' },
    sleep: { icon: Moon, label: 'Сон', color: 'bg-indigo-100 text-indigo-600' },
    bath: { icon: Bath, label: 'Купание', color: 'bg-cyan-100 text-cyan-600' },
    walk: { icon: Wind, label: 'Прогулка', color: 'bg-green-100 text-green-600' },
    activity: { icon: Activity, label: 'Активность', color: 'bg-orange-100 text-orange-600' },
    burp: { icon: Undo2, label: 'Отрыжка', color: 'bg-lime-100 text-lime-700' },
    diaper: { icon: Droplets, label: 'Подгузник', color: 'bg-yellow-100 text-yellow-600' },
    medicine: { icon: Pill, label: 'Лекарство', color: 'bg-red-100 text-red-600' },
  };

  const burpColorOptions = ['Белый', 'Жёлтый', 'Зелёный', 'Прозрачный'];
  const burpConsistencyOptions = ['Жидкая', 'Густая', 'Пенистая'];
  const burpVolumeOptions = ['less_than_teaspoon', 'more_than_teaspoon'];

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  // Helper to convert ISO string to local datetime-local format
  const toLocalDateTimeString = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Helper to convert local datetime-local value to ISO string
  const fromLocalDateTimeString = (localString) => {
    if (!localString) return '';
    // Local datetime string is already in local timezone, just add seconds and convert to ISO
    const date = new Date(localString);
    return date.toISOString();
  };

  const formatDuration = (start, end) => {
    const diff = new Date(end) - new Date(start);
    const minutes = Math.floor(diff / 60000);
    
    // Don't show duration if less than 1 minute
    if (minutes < 1) return '';
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours > 0 ? `${hours}ч ${remainingMinutes}м` : `${remainingMinutes}м`;
  };

  const getTimerDuration = (startTime, pausedDuration = 0) => {
    const parsedStartTime = Number(startTime);
    const parsedPausedDuration = Number(pausedDuration) || 0;
    const diff = Number.isFinite(parsedStartTime)
      ? Math.max(0, Date.now() - parsedStartTime)
      : Math.max(0, parsedPausedDuration);
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatSeconds = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const BURP_COMMENT_PREFIX = '[BURP_DATA]';

  const serializeBurpComment = (comment, burpData) => {
    const payload = {
      comment: comment || '',
      color: burpData?.burpColor || null,
      consistency: burpData?.burpConsistency || null,
      volume: burpData?.burpVolume || null,
    };

    return `${BURP_COMMENT_PREFIX}${JSON.stringify(payload)}`;
  };

  const parseBurpComment = (comment) => {
    if (typeof comment !== 'string' || !comment.startsWith(BURP_COMMENT_PREFIX)) {
      return {
        comment: comment || '',
        burpColor: null,
        burpConsistency: null,
        burpVolume: null,
      };
    }

    try {
      const parsed = JSON.parse(comment.slice(BURP_COMMENT_PREFIX.length));
      return {
        comment: parsed.comment || '',
        burpColor: parsed.color || null,
        burpConsistency: parsed.consistency || null,
        burpVolume: parsed.volume || null,
      };
    } catch (error) {
      console.error('Failed to parse burp payload from comment:', error);
      return {
        comment,
        burpColor: null,
        burpConsistency: null,
        burpVolume: null,
      };
    }
  };

  const normalizeSystemComment = (comment) => {
    if (typeof comment !== 'string') return '';

    const normalized = comment.trim();
    if (!normalized) return '';

    if (normalized === 'started_from:telegram' || normalized === 'quick_add:telegram') {
      return 'Добавлено через Telegram';
    }

    if (normalized === 'side:left' || normalized === 'side:right') {
      return '';
    }

    return normalized;
  };

  // Convert Supabase activity to app format
  const convertFromSupabaseActivity = (dbActivity) => {
    const parsedBurpComment = dbActivity.type === 'burp'
      ? parseBurpComment(dbActivity.comment)
      : null;

    return {
      id: dbActivity.id,
      type: dbActivity.type,
      startTime: dbActivity.start_time,
      endTime: dbActivity.end_time,
      comment: normalizeSystemComment(parsedBurpComment?.comment ?? dbActivity.comment),
      date: new Date(dbActivity.start_time).toLocaleDateString('ru-RU'),
      // Type-specific fields
      leftDuration: dbActivity.left_duration,
      rightDuration: dbActivity.right_duration,
      foodType: dbActivity.food_type,
      amount: dbActivity.amount,
      diaperType: dbActivity.diaper_type,
      medicineName: dbActivity.medicine_name,
      burpColor: parsedBurpComment?.burpColor ?? dbActivity.food_type,
      burpConsistency: parsedBurpComment?.burpConsistency ?? dbActivity.diaper_type,
      burpVolume: parsedBurpComment?.burpVolume ?? dbActivity.medicine_name,
    };
  };

  // Convert app activity to Supabase format
  const convertToSupabaseActivity = (activity) => {
    const isBurp = activity.type === 'burp';

    return {
      type: activity.type,
      startTime: activity.startTime,
      endTime: activity.endTime,
      comment: isBurp
        ? serializeBurpComment(activity.comment, activity)
        : activity.comment,
      // Type-specific fields
      leftDuration: activity.leftDuration,
      rightDuration: activity.rightDuration,
      foodType: isBurp ? null : activity.foodType,
      amount: activity.type === 'bottle' && activity.amount ? parseInt(activity.amount, 10) : null,
      diaperType: isBurp ? null : activity.diaperType,
      medicineName: isBurp ? null : activity.medicineName,
    };
  };

  // Convert Supabase growth record to app format
  const convertFromSupabaseGrowth = (dbRecord) => {
    return {
      id: dbRecord.id,
      date: dbRecord.measurement_date,
      weight: dbRecord.weight,
      height: dbRecord.height,
    };
  };

  const loadFromCache = useCallback(async () => {
    const [savedActivities, savedTimers, savedPaused, savedTimerMeta, savedProfile, savedGrowth] = await Promise.all([
      cacheService.get('baby_activities'),
      cacheService.get('active_timers'),
      cacheService.get('paused_timers'),
      cacheService.get('timer_meta'),
      cacheService.get('baby_profile'),
      cacheService.get('growth_data')
    ]);

    if (savedActivities) setActivities(savedActivities);
    if (savedTimers) setTimers(savedTimers);
    if (savedPaused) setPausedTimers(savedPaused);
    if (savedTimerMeta) setTimerMeta(savedTimerMeta);
    if (savedProfile) setBabyProfile(savedProfile);
    if (savedGrowth) setGrowthData(savedGrowth);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    
    // Set a timeout to prevent infinite loading
    const loadTimeout = setTimeout(() => {
      console.warn('Load timeout - using cache fallback');
      setAuthError('Превышено время ожидания');
      void loadFromCache();
      setIsLoading(false);
    }, 10000); // 10 seconds timeout
    
    try {
      // Check if we're in Telegram and if Supabase is configured
      const hasSupabase =
        supabaseModule.isSupabaseConfigured &&
        supabaseModule.authHelpers &&
        typeof supabaseModule.authHelpers.signInWithTelegram === 'function';

      if (hasSupabase) {
        const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
        cacheService.setNamespace(telegramUser?.id ? `telegram_${telegramUser.id}` : 'global');

        try {
          const { user, error, mode } = await supabaseModule.authHelpers.ensureAuthenticatedSession({ telegramUser });

          if (error) {
            console.error('Auth error:', error);
            setAuthError('Ошибка аутентификации - используется кеш');
            await loadFromCache();
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
          }

          setIsAuthenticated(Boolean(user));

          if (mode === 'anonymous') {
            console.log('Signed in with anonymous Supabase session');
          }

          try {
            const initialData = supabaseModule.appDataHelpers
              ? await supabaseModule.appDataHelpers.getInitialData()
              : {
                  profile: await supabaseModule.babyHelpers.getProfile(),
                  activities: await supabaseModule.activityHelpers.getActivities(),
                  growth: await supabaseModule.growthHelpers.getRecords(),
                };

            if (initialData.profile?.data) {
              setBabyProfile({
                name: initialData.profile.data.name || '',
                birthDate: initialData.profile.data.birth_date || '',
                photo: initialData.profile.data.photo_url || null,
              });
            }

            if (initialData.activities?.data) {
              setActivities(initialData.activities.data.map(convertFromSupabaseActivity));
            }

            if (initialData.growth?.data) {
              setGrowthData(initialData.growth.data.map(convertFromSupabaseGrowth));
            }
          } catch (err) {
            console.error('Initial data load error:', err);
          }

          // Load timers from cache (temporary data)
          const [savedTimers, savedPaused, savedTimerMeta] = await Promise.all([
            cacheService.get('active_timers'),
            cacheService.get('paused_timers'),
            cacheService.get('timer_meta')
          ]);
          if (savedTimers) setTimers(savedTimers);
          if (savedPaused) setPausedTimers(savedPaused);
          if (savedTimerMeta) setTimerMeta(savedTimerMeta);

          await notificationService.initialize();
        } catch (supabaseError) {
          console.error('Supabase error:', supabaseError);
          setAuthError('Supabase недоступен - используется кеш');
          await loadFromCache();
        }
      } else {
        // Not in Telegram or Supabase not configured, use cache
        const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
        cacheService.setNamespace(telegramUser?.id ? `telegram_${telegramUser.id}` : 'global');
        console.log('Using cache fallback (no Telegram or Supabase config)');
        await loadFromCache();
      }
    } catch (error) {
      console.error('Load data error:', error);
      setAuthError('Ошибка загрузки данных');
      await loadFromCache();
    } finally {
      clearTimeout(loadTimeout);
      setIsLoading(false);
    }
  }, [loadFromCache]);

  const getActivityChronologyTime = useCallback((activity) => {
    if (!activity) return 0;
    const preferredTime = activity.startTime || activity.endTime;
    const parsed = new Date(preferredTime).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const activitiesByChronology = useMemo(() => {
    return [...activities].sort((a, b) => getActivityChronologyTime(b) - getActivityChronologyTime(a));
  }, [activities, getActivityChronologyTime]);

  const recentCompletedActivities = useMemo(() => {
    return activitiesByChronology.filter((activity) => Boolean(activity.endTime));
  }, [activitiesByChronology]);

  const hasBabyProfile = useMemo(() => {
    return Boolean(babyProfile.name?.trim() && babyProfile.birthDate);
  }, [babyProfile]);

  const handleBack = useCallback(() => {
    if (view !== 'main') {
      if (tg) tg.HapticFeedback?.impactOccurred('light');
      setView('main');
      setSelectedActivity(null);
      setFormData({});
      setEditingId(null);
    }
  }, [view, tg]);

  const getTotalDuration = (timerType) => {
    const activeTimerStart = Number(timers[timerType]);
    const pausedDuration = Number(pausedTimers[timerType]);

    if (Number.isFinite(activeTimerStart)) {
      return Math.floor(Math.max(0, Date.now() - activeTimerStart) / 1000);
    }

    if (Number.isFinite(pausedDuration)) {
      return Math.floor(Math.max(0, pausedDuration) / 1000);
    }

    return 0;
  };

  const resetTimer = (timerType) => {
    setTimers(prev => {
      const newTimers = { ...prev };
      delete newTimers[timerType];
      return newTimers;
    });
    setPausedTimers(prev => {
      const newPaused = { ...prev };
      delete newPaused[timerType];
      return newPaused;
    });

    if (timerType === 'left' || timerType === 'right') {
      setTimerMeta(prev => {
        if (!prev.breastfeedingStartTime) return prev;

        const hasOtherBreastTimer = timerType === 'left'
          ? Boolean(timers.right || pausedTimers.right)
          : Boolean(timers.left || pausedTimers.left);

        if (hasOtherBreastTimer) return prev;

        const updatedMeta = { ...prev };
        delete updatedMeta.breastfeedingStartTime;
        return updatedMeta;
      });
    }

    if (timerType === 'sleep' || timerType === 'walk' || timerType === 'activity') {
      setTimerMeta(prev => {
        const metaKey = `${timerType}StartTime`;
        if (!prev[metaKey]) return prev;
        const updatedMeta = { ...prev };
        delete updatedMeta[metaKey];
        return updatedMeta;
      });
    }
  };

  const saveActivity = useCallback(async () => {
    // Prevent double saves
    if (isSaving) {
      console.log('Already saving, ignoring duplicate request');
      return;
    }

    if (!hasBabyProfile) {
      alert('Сначала заполните данные малыша');
      setView('onboarding');
      return;
    }
    
    setIsSaving(true);
    
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
    
    // Validate required fields
    if (!formData.type || !formData.startTime) {
      if (tg) tg.HapticFeedback?.notificationOccurred('error');
      alert('Пожалуйста, заполните обязательные поля');
      setIsSaving(false);
      return;
    }

    if ((formData.type === 'sleep' || formData.type === 'walk' || formData.type === 'activity') && formData.endTime) {
      if (new Date(formData.endTime) <= new Date(formData.startTime)) {
        if (tg) tg.HapticFeedback?.notificationOccurred('error');
        alert('Время окончания должно быть позже времени начала');
        setIsSaving(false);
        return;
      }
    }

    if (formData.type === 'burp' && (!formData.burpColor || !formData.burpConsistency || !formData.burpVolume)) {
      if (tg) tg.HapticFeedback?.notificationOccurred('error');
      alert('Заполните цвет, консистенцию и объём отрыжки');
      setIsSaving(false);
      return;
    }
    
    const activityData = {
      id: editingId || Date.now(),
      ...formData,
      date: new Date(formData.startTime).toLocaleDateString('ru-RU'),
    };

    if (formData.type === 'breastfeeding') {
      let leftDuration = formData.manualLeftMinutes ? parseInt(formData.manualLeftMinutes) * 60 : (editingId ? 0 : getTotalDuration('left'));
      let rightDuration = formData.manualRightMinutes ? parseInt(formData.manualRightMinutes) * 60 : (editingId ? 0 : getTotalDuration('right'));
      const leftRoundedMinutes = Math.round(leftDuration / 60);
      const rightRoundedMinutes = Math.round(rightDuration / 60);
      const totalDuration = (leftRoundedMinutes + rightRoundedMinutes) * 60;
      const breastfeedingStartTime = timerMeta.breastfeedingStartTime || formData.startTime;

      activityData.leftDuration = leftRoundedMinutes * 60;
      activityData.rightDuration = rightRoundedMinutes * 60;
      activityData.startTime = breastfeedingStartTime;
      activityData.endTime = new Date(new Date(breastfeedingStartTime).getTime() + totalDuration * 1000).toISOString();
      
      if (!editingId) {
        resetTimer('left');
        resetTimer('right');
        setTimerMeta(prev => {
          if (!prev.breastfeedingStartTime) return prev;
          const updatedMeta = { ...prev };
          delete updatedMeta.breastfeedingStartTime;
          return updatedMeta;
        });
      }
    } else if (formData.type === 'sleep' || formData.type === 'walk' || formData.type === 'activity') {
      const timerKey = formData.type;
      const isTimerMode = formData.timeInputMode === 'timer';
      if (!editingId && isTimerMode && (timers[timerKey] || pausedTimers[timerKey])) {
        const duration = getTotalDuration(timerKey);
        const timerStartTime = timerMeta[`${timerKey}StartTime`] || formData.startTime;
        activityData.startTime = timerStartTime;
        activityData.endTime = new Date(new Date(timerStartTime).getTime() + duration * 1000).toISOString();
        resetTimer(timerKey);
      } else if (formData.endTime) {
        activityData.endTime = formData.endTime;
      } else {
        // For manual historical records without end time,
        // keep chronology based on the selected start time.
        activityData.endTime = activityData.startTime;
      }
    } else if (formData.type === 'burp') {
      activityData.endTime = null;
      activityData.foodType = null;
      activityData.diaperType = null;
      activityData.medicineName = null;
    } else if (!['bath', 'diaper', 'medicine', 'burp'].includes(formData.type) && !activityData.endTime) {
      activityData.endTime = new Date().toISOString();
    }

    try {
      if (isAuthenticated) {
        // Save to Supabase
        const supabaseData = convertToSupabaseActivity(activityData);
        
        if (editingId) {
          const { data, error } = await supabaseModule.activityHelpers.updateActivity(editingId, supabaseData);
          if (error) throw error;
          setActivities(prev => prev.map(a => a.id === editingId ? convertFromSupabaseActivity(data) : a));
        } else {
          const { data, error } = await supabaseModule.activityHelpers.createActivity(supabaseData);
          if (error) throw error;
          setActivities(prev => [convertFromSupabaseActivity(data), ...prev]);
        }
      } else {
        // Fallback to cache
        if (editingId) {
          const updatedActivities = activities.map(a => a.id === editingId ? activityData : a);
          setActivities(updatedActivities);
          await cacheService.set('baby_activities', updatedActivities, CACHE_TTL_SECONDS);
        } else {
          const updatedActivities = [activityData, ...activities];
          setActivities(updatedActivities);
          await cacheService.set('baby_activities', updatedActivities, CACHE_TTL_SECONDS);
        }
      }
    } catch (error) {
      console.error('Save activity error:', error);
      if (tg) tg.HapticFeedback?.notificationOccurred('error');
      alert('Ошибка сохранения активности');
      setIsSaving(false);
      return;
    }
    
    setView('main');
    setSelectedActivity(null);
    setFormData({});
    setEditingId(null);
    setIsSaving(false);
  }, [formData, tg, timers, pausedTimers, timerMeta, editingId, getTotalDuration, resetTimer, isAuthenticated, activities, isSaving, hasBabyProfile]);

  const deleteActivity = async (id) => {
    if (tg) tg.HapticFeedback?.notificationOccurred('warning');
    if (window.confirm('Удалить эту запись?')) {
      try {
        if (isAuthenticated) {
          const { error } = await supabaseModule.activityHelpers.deleteActivity(id);
          if (error) throw error;
        } else {
          await cacheService.set('baby_activities', activities.filter(a => a.id !== id), CACHE_TTL_SECONDS);
        }
        setActivities(prev => prev.filter(a => a.id !== id));
      } catch (error) {
        console.error('Delete activity error:', error);
        alert('Ошибка удаления активности');
      }
    }
  };

  const editActivity = (activity) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    setEditingId(activity.id);
    setSelectedActivity(activity.type);
    setFormData(activity);
    setView('add');
  };

  const getActiveTimers = () => {
    const activeTimers = [];
    
    // Проверяем кормление грудью
    if (timers.left || timers.right || pausedTimers.left || pausedTimers.right) {
      activeTimers.push({ 
        type: 'breastfeeding', 
        timers: ['left', 'right'],
        leftTime: getTotalDuration('left'),
        rightTime: getTotalDuration('right')
      });
    }
    
    // Проверяем сон
    if (timers.sleep || pausedTimers.sleep) {
      activeTimers.push({ 
        type: 'sleep', 
        timers: ['sleep'],
        time: getTotalDuration('sleep')
      });
    }
    
    // Проверяем прогулку
    if (timers.walk || pausedTimers.walk) {
      activeTimers.push({ 
        type: 'walk', 
        timers: ['walk'],
        time: getTotalDuration('walk')
      });
    }

    if (timers.activity || pausedTimers.activity) {
      activeTimers.push({
        type: 'activity',
        timers: ['activity'],
        time: getTotalDuration('activity')
      });
    }
    
    return activeTimers;
  };

  const getTodayStats = () => {
    const today = new Date().toLocaleDateString('ru-RU');
    const todayActivities = activities.filter(a => a.date === today);
    
    const stats = {};
    todayActivities.forEach(activity => {
      if (!stats[activity.type]) {
        stats[activity.type] = { count: 0, totalDuration: 0, totalAmount: 0 };
      }
      stats[activity.type].count++;
      
      if (activity.startTime && activity.endTime) {
        stats[activity.type].totalDuration += new Date(activity.endTime) - new Date(activity.startTime);
      } else if (activity.type === 'breastfeeding') {
        stats[activity.type].totalDuration += (activity.leftDuration + activity.rightDuration) * 1000;
      }
      
      if (activity.amount) {
        stats[activity.type].totalAmount += parseInt(activity.amount) || 0;
      }
    });
    
    return stats;
  };

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const telegram = window.Telegram.WebApp;
      telegram.ready();
      telegram.expand();
      telegram.setHeaderColor('#9333ea');
      telegram.setBackgroundColor('#faf5ff');
      setTg(telegram);
      telegram.MainButton.hide();
    }
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!tg) return;

    // Для единообразной навигации используем только web-кнопки внутри UI.
    // Системные кнопки Telegram скрываем, чтобы не дублировать логику на Android.
    tg.BackButton.hide();
    tg.BackButton.offClick(handleBack);
    tg.MainButton.hide();
    tg.MainButton.offClick(saveActivity);

    return () => {
      tg.BackButton.offClick(handleBack);
      tg.MainButton.offClick(saveActivity);
    };
  }, [view, tg, handleBack, saveActivity, editingId, isSaving]);

  useEffect(() => {
    if (!isLoading) {
      // Save timers to cache with 1-hour TTL
      void Promise.all([
        cacheService.set('active_timers', timers, CACHE_TTL_SECONDS),
        cacheService.set('paused_timers', pausedTimers, CACHE_TTL_SECONDS),
        cacheService.set('timer_meta', timerMeta, CACHE_TTL_SECONDS),
      ]);
    }
  }, [timers, pausedTimers, timerMeta, isLoading]);

  useEffect(() => {
    const interval = setInterval(() => setTimers(prev => ({ ...prev })), 1000);
    return () => clearInterval(interval);
  }, []);

  // Update component every minute to refresh "time since" display
  const [, setRefreshTrigger] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Sync profileForm with babyProfile when entering profile view
  useEffect(() => {
    if (view === 'profile' || view === 'onboarding') {
      setProfileForm(babyProfile);
    }
  }, [view, babyProfile]);

  useEffect(() => {
    if (!isLoading && !hasBabyProfile && view === 'main') {
      setProfileForm(prev => ({
        ...prev,
        name: babyProfile.name || '',
        birthDate: babyProfile.birthDate || '',
        photo: babyProfile.photo || null,
      }));
      setView('onboarding');
    }
  }, [isLoading, hasBabyProfile, view, babyProfile]);

  useEffect(() => {
    if (view !== 'notifications' || notificationHelpers) return;

    let isMounted = true;
    import('./utils/notifications.js')
      .then((module) => {
        if (isMounted) {
          setNotificationHelpers(() => module.notificationHelpers);
        }
      })
      .catch((error) => {
        console.error('Failed to load notification helpers:', error);
      });

    return () => {
      isMounted = false;
    };
  }, [view, notificationHelpers]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!isAuthenticated) return;

    const activitiesSubscription = supabaseModule.subscribeToActivities((payload) => {
      console.log('Activity change:', payload);
      if (payload.eventType === 'INSERT') {
        setActivities(prev => [convertFromSupabaseActivity(payload.new), ...prev]);
      } else if (payload.eventType === 'UPDATE') {
        setActivities(prev => prev.map(a => a.id === payload.new.id ? convertFromSupabaseActivity(payload.new) : a));
      } else if (payload.eventType === 'DELETE') {
        setActivities(prev => prev.filter(a => a.id !== payload.old.id));
      }
    });

    const growthSubscription = supabaseModule.subscribeToGrowthRecords((payload) => {
      console.log('Growth change:', payload);
      if (payload.eventType === 'INSERT') {
        setGrowthData(prev => [...prev, convertFromSupabaseGrowth(payload.new)].sort((a, b) => new Date(a.date) - new Date(b.date)));
      } else if (payload.eventType === 'UPDATE') {
        setGrowthData(prev => prev.map(r => r.id === payload.new.id ? convertFromSupabaseGrowth(payload.new) : r));
      } else if (payload.eventType === 'DELETE') {
        setGrowthData(prev => prev.filter(r => r.id !== payload.old.id));
      }
    });

    return () => {
      if (activitiesSubscription) {
        supabaseModule.supabase.removeChannel(activitiesSubscription);
      }
      if (growthSubscription) {
        supabaseModule.supabase.removeChannel(growthSubscription);
      }
    };
  }, [isAuthenticated]);

  const startActivity = (type) => {
    if (!hasBabyProfile) {
      alert('Сначала заполните данные малыша');
      setView('onboarding');
      return;
    }

    if (tg) tg.HapticFeedback?.impactOccurred('light');
    
    setSelectedActivity(type);
    setEditingId(null);
    const now = new Date().toISOString();
    const baseData = { type, startTime: now, comment: '' };
    
    if (type === 'breastfeeding') {
      setFormData({ ...baseData, leftDuration: 0, rightDuration: 0, manualLeftMinutes: '', manualRightMinutes: '', timeInputMode: null });
    } else if (type === 'bottle') {
      setFormData({ ...baseData, foodType: 'breast_milk', amount: '' });
    } else if (type === 'diaper') {
      setFormData({ ...baseData, diaperType: 'wet' });
    } else if (type === 'burp') {
      setFormData({
        ...baseData,
        burpColor: burpColorOptions[0],
        burpConsistency: burpConsistencyOptions[0],
        burpVolume: burpVolumeOptions[0],
        endTime: null,
      });
    } else if (type === 'medicine') {
      setFormData({ ...baseData, medicineName: '' });
    } else {
      setFormData(
        (type === 'sleep' || type === 'walk' || type === 'activity')
          ? { ...baseData, endTime: '', timeInputMode: null }
          : baseData
      );
    }
    
    setView('add');
  };

  const continueActivity = (type) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    setSelectedActivity(type);
    
    // Keep original timer start time so saved interval is correct
    const getTimerStartTime = (timerKey) => {
      if (timers[timerKey]) {
        return new Date(timers[timerKey]).toISOString();
      }

      if (pausedTimers[timerKey]) {
        return new Date(Date.now() - pausedTimers[timerKey]).toISOString();
      }

      return null;
    };

    const startTime = type === 'breastfeeding'
      ? (
        timerMeta.breastfeedingStartTime
        || getTimerStartTime('left')
        || getTimerStartTime('right')
        || new Date().toISOString()
      )
      : (
        timerMeta[`${type}StartTime`]
        || getTimerStartTime(type)
        || new Date().toISOString()
      );

    if (type === 'breastfeeding') {
      setFormData({ 
        type, 
        startTime,
        comment: '',
        leftDuration: getTotalDuration('left'),
        rightDuration: getTotalDuration('right'),
        manualLeftMinutes: '',
        manualRightMinutes: '',
        timeInputMode: 'timer'
      });
    } else {
      const hasTimerData = Boolean(timers[type] || pausedTimers[type]);
      setFormData({ 
        type, 
        startTime,
        endTime: '',
        comment: '',
        timeInputMode: hasTimerData ? 'timer' : null,
      });
    }
    
    setView('add');
  };

  // Get time since last activity of this type with improved formatting
  const getTimeSinceLastActivity = (type) => {
    const typeActivities = activitiesByChronology.filter(a => a.type === type);
    if (typeActivities.length === 0) return null;

    const lastActivity = typeActivities[0];
    const lastTime = lastActivity.startTime || lastActivity.endTime;
    if (!lastTime) return null;
    
    const now = Date.now();
    const lastTimeMs = new Date(lastTime).getTime();
    const diffMs = now - lastTimeMs;
    
    // Calculate time components
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    // Format based on time elapsed
    if (days >= 365) {
      const years = Math.floor(days / 365);
      const remainingDays = days % 365;
      if (remainingDays > 30) {
        const months = Math.floor(remainingDays / 30);
        return `${years}г ${months}мес назад`;
      }
      return `${years}г назад`;
    } else if (days >= 30) {
      const months = Math.floor(days / 30);
      const remainingDays = days % 30;
      if (remainingDays > 0) {
        return `${months}мес ${remainingDays}д назад`;
      }
      return `${months}мес назад`;
    } else if (days > 0) {
      if (hours > 0) {
        return `${days}д ${hours}ч назад`;
      }
      return `${days}д назад`;
    } else if (hours > 0) {
      return `${hours}ч ${minutes}м назад`;
    } else if (minutes > 0) {
      return `${minutes}м назад`;
    } else {
      return 'только что';
    }
  };

  // Profile functions
  const saveProfile = useCallback(async () => {
    if (isSavingProfile) return; // Prevent double saves

    if (!profileForm.name?.trim() || !profileForm.birthDate) {
      alert('Укажите имя и дату рождения малыша');
      return;
    }
    
    setIsSavingProfile(true);
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
    
    try {
      if (isAuthenticated) {
        const { data, error } = await supabaseModule.babyHelpers.upsertProfile({
          name: profileForm.name.trim(),
          birthDate: profileForm.birthDate,
          photo: profileForm.photo,
        });
        if (error) throw error;
        setBabyProfile({
          name: data.name || '',
          birthDate: data.birth_date || '',
          photo: data.photo_url || null,
        });
      } else {
        const trimmedProfile = {
          ...profileForm,
          name: profileForm.name.trim(),
        };
        setBabyProfile(trimmedProfile);
        await cacheService.set('baby_profile', trimmedProfile, CACHE_TTL_SECONDS);
      }
      setView('main');
    } catch (error) {
      console.error('Save profile error:', error);
      alert('Ошибка сохранения профиля');
    } finally {
      setIsSavingProfile(false);
    }
  }, [profileForm, tg, isAuthenticated, isSavingProfile]);

  const addGrowthRecord = useCallback(async () => {
    if (isSavingGrowth) return; // Prevent double saves
    
    if (!growthForm.date) {
      alert('Укажите дату измерения');
      return;
    }
    if (!growthForm.weight && !growthForm.height) {
      alert('Укажите хотя бы один параметр (вес или рост)');
      return;
    }

    setIsSavingGrowth(true);
    if (tg) tg.HapticFeedback?.notificationOccurred('success');

    const record = {
      id: editingGrowthId || Date.now(),
      date: growthForm.date,
      weight: growthForm.weight ? parseFloat(growthForm.weight) : null,
      height: growthForm.height ? parseFloat(growthForm.height) : null
    };

    try {
      if (isAuthenticated) {
        if (editingGrowthId) {
          const { data, error } = await supabaseModule.growthHelpers.updateRecord(editingGrowthId, record);
          if (error) throw error;
          setGrowthData(prev => prev.map(r => r.id === editingGrowthId ? convertFromSupabaseGrowth(data) : r));
        } else {
          const { data, error } = await supabaseModule.growthHelpers.createRecord(record);
          if (error) throw error;
          setGrowthData(prev => [...prev, convertFromSupabaseGrowth(data)].sort((a, b) => new Date(a.date) - new Date(b.date)));
        }
      } else {
        if (editingGrowthId) {
          const updatedGrowthData = growthData.map(r => r.id === editingGrowthId ? record : r);
          setGrowthData(updatedGrowthData);
          await cacheService.set('growth_data', updatedGrowthData, CACHE_TTL_SECONDS);
        } else {
          const updatedGrowthData = [...growthData, record].sort((a, b) => new Date(a.date) - new Date(b.date));
          setGrowthData(updatedGrowthData);
          await cacheService.set('growth_data', updatedGrowthData, CACHE_TTL_SECONDS);
        }
      }
      
      setEditingGrowthId(null);
      setGrowthForm({ date: '', weight: '', height: '' });
    } catch (error) {
      console.error('Save growth record error:', error);
      alert('Ошибка сохранения записи');
    } finally {
      setIsSavingGrowth(false);
    }
  }, [growthForm, editingGrowthId, tg, isAuthenticated, growthData, isSavingGrowth]);

  const deleteGrowthRecord = useCallback(async (id) => {
    if (window.confirm('Удалить запись?')) {
      if (tg) tg.HapticFeedback?.notificationOccurred('warning');
      
      try {
        if (isAuthenticated) {
          const { error } = await supabaseModule.growthHelpers.deleteRecord(id);
          if (error) throw error;
        } else {
          await cacheService.set('growth_data', growthData.filter(r => r.id !== id), CACHE_TTL_SECONDS);
        }
        
        setGrowthData(prev => prev.filter(r => r.id !== id));
        if (editingGrowthId === id) {
          setEditingGrowthId(null);
          setGrowthForm({ date: '', weight: '', height: '' });
        }
      } catch (error) {
        console.error('Delete growth record error:', error);
        alert('Ошибка удаления записи');
      }
    }
  }, [editingGrowthId, tg, isAuthenticated, growthData]);

  const editGrowthRecord = useCallback((record) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    setEditingGrowthId(record.id);
    setGrowthForm({
      date: record.date,
      weight: record.weight || '',
      height: record.height || ''
    });
  }, [tg]);

  const calculateAge = useCallback((birthDateValue = babyProfile.birthDate) => {
    if (!birthDateValue) return '';

    const [year, month, day] = birthDateValue.split('-').map(Number);
    const birth = new Date(year, (month || 1) - 1, day || 1);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (birth > today) return '0 дн.';

    let years = today.getFullYear() - birth.getFullYear();
    let months = today.getMonth() - birth.getMonth();
    let days = today.getDate() - birth.getDate();

    if (days < 0) {
      const prevMonthLastDay = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
      days += prevMonthLastDay;
      months -= 1;
    }

    if (months < 0) {
      months += 12;
      years -= 1;
    }

    const parts = [];
    if (years > 0) parts.push(`${years} г.`);
    if (months > 0) parts.push(`${months} мес.`);
    if (days > 0 || parts.length === 0) parts.push(`${days} дн.`);

    return parts.join(' ');
  }, [babyProfile.birthDate]);

  const startTimer = (timerType, activityType) => {
    if (tg) tg.HapticFeedback?.impactOccurred('medium');
    const key = ['sleep', 'walk', 'activity'].includes(activityType) ? activityType : timerType;
    const now = Date.now();

    if (activityType === 'breastfeeding' && (timerType === 'left' || timerType === 'right')) {
      const otherSide = timerType === 'left' ? 'right' : 'left';
      const nextTimers = { ...timers };
      const nextPausedTimers = { ...pausedTimers };

      if (nextTimers[otherSide]) {
        const otherStartedAt = Number(nextTimers[otherSide]);
        nextPausedTimers[otherSide] = Number.isFinite(otherStartedAt) ? Math.max(0, now - otherStartedAt) : 0;
        delete nextTimers[otherSide];
      }

      const ownPausedDuration = Number(nextPausedTimers[key]);
      nextTimers[key] = now - (Number.isFinite(ownPausedDuration) ? ownPausedDuration : 0);

      setPausedTimers(nextPausedTimers);
      setTimers(nextTimers);

      setTimerMeta(prev => ({
        ...prev,
        breastfeedingStartTime: prev.breastfeedingStartTime || new Date(now).toISOString()
      }));

      setFormData(prev => ({
        ...prev,
        timeInputMode: 'timer',
        manualLeftMinutes: '',
        manualRightMinutes: '',
      }));

      return;
    }

    const pausedDuration = Number(pausedTimers[key]);
    setTimers(prev => ({ ...prev, [key]: now - (Number.isFinite(pausedDuration) ? pausedDuration : 0) }));
    setTimerMeta(prev => ({
      ...prev,
      [`${key}StartTime`]: prev[`${key}StartTime`] || new Date(now - (Number.isFinite(pausedDuration) ? pausedDuration : 0)).toISOString()
    }));

    if (activityType === 'sleep' || activityType === 'walk' || activityType === 'activity') {
      setFormData(prev => ({
        ...prev,
        timeInputMode: 'timer',
        endTime: '',
      }));
    }
  };

  const pauseTimer = (timerType, activityType) => {
    if (tg) tg.HapticFeedback?.impactOccurred('medium');
    const key = ['sleep', 'walk', 'activity'].includes(activityType) ? activityType : timerType;
    if (timers[key]) {
      setPausedTimers(prev => ({ ...prev, [key]: Date.now() - timers[key] }));
      setTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[key];
        return newTimers;
      });
    }
  };

  const handleSleepWalkManualChange = (field, value) => {
    if (timers[selectedActivity] || pausedTimers[selectedActivity]) {
      resetTimer(selectedActivity);
    }

    setFormData(prev => ({
      ...prev,
      [field]: value,
      timeInputMode: 'manual',
    }));
  };

  const handleBreastfeedingManualChange = (field, value) => {
    if (!editingId && (timers.left || timers.right || pausedTimers.left || pausedTimers.right)) {
      resetTimer('left');
      resetTimer('right');
      setTimerMeta(prev => {
        if (!prev.breastfeedingStartTime) return prev;
        const updatedMeta = { ...prev };
        delete updatedMeta.breastfeedingStartTime;
        return updatedMeta;
      });
    }

    setFormData(prev => ({
      ...prev,
      [field]: value,
      timeInputMode: 'manual',
    }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка...</p>
          {authError && (
            <p className="text-sm text-orange-600 mt-2">
              {authError}<br />
              Используется локальное хранилище
            </p>
          )}
        </div>
      </div>
    );
  }

  const activeTimers = getActiveTimers();

  if (view === 'add' && selectedActivity) {
    const ActivityIcon = activityTypes[selectedActivity]?.icon;
    
    if (!ActivityIcon) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600">Ошибка загрузки активности</p>
            <button 
              onClick={handleBack}
              className="mt-4 bg-purple-500 text-white px-6 py-2 rounded-lg"
            >
              Вернуться
            </button>
          </div>
        </div>
      );
    }
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        {/* Отступ для Telegram заголовка */}
        <div className="h-16" />
        
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between gap-3 mb-6">
              <button
                onClick={handleBack}
                className="p-2 rounded-lg bg-gray-100 text-gray-700 active:scale-95 transition-transform"
                title="Назад"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center flex-1 min-w-0">
                <ActivityIcon className="w-6 h-6 mr-2 shrink-0" />
                <h2 className="text-xl font-semibold truncate">{activityTypes[selectedActivity].label}</h2>
              </div>

              <button
                onClick={saveActivity}
                disabled={isSaving}
                className={`px-4 py-2 rounded-lg font-medium text-white transition-all ${
                  isSaving ? 'bg-purple-300 cursor-not-allowed' : 'bg-purple-600 active:scale-95'
                }`}
              >
                {isSaving ? 'Сохранение...' : (editingId ? 'Обновить' : 'Сохранить')}
              </button>
            </div>

            <div className="space-y-4">
              {selectedActivity === 'breastfeeding' && (
                <div className="space-y-4">
                  {!editingId && (
                    <div className="grid grid-cols-2 gap-4">
                      {['left', 'right'].map(side => (
                        <div key={side} className="border-2 border-pink-200 rounded-lg p-4">
                          <div className="text-center mb-2 font-medium">{side === 'left' ? 'Левая' : 'Правая'} грудь</div>
                          <div className="text-2xl font-mono text-center mb-3">
                            {formatSeconds(getTotalDuration(side))}
                          </div>
                          <button
                            onClick={() => timers[side] ? pauseTimer(side, 'breastfeeding') : startTimer(side, 'breastfeeding')}
                            disabled={formData.timeInputMode === 'manual' && !timers[side]}
                            className={`w-full py-2 rounded-lg flex items-center justify-center mb-2 ${
                              timers[side] ? 'bg-red-500 text-white' : 'bg-pink-500 text-white'
                            } ${(formData.timeInputMode === 'manual' && !timers[side]) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {timers[side] ? <><Pause className="w-4 h-4 mr-2" />Стоп</> : <><Play className="w-4 h-4 mr-2" />Старт</>}
                          </button>
                          <input
                            type="number"
                            placeholder="или мин"
                            className="w-full border border-gray-300 rounded-lg p-2 text-center text-sm disabled:bg-gray-100 disabled:text-gray-500"
                            disabled={formData.timeInputMode === 'timer'}
                            value={formData[`manual${side === 'left' ? 'Left' : 'Right'}Minutes`] || ''}
                            onChange={(e) => handleBreastfeedingManualChange(`manual${side === 'left' ? 'Left' : 'Right'}Minutes`, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {!editingId && formData.timeInputMode === 'manual' && (
                    <div className="text-xs text-center text-gray-500">Таймер недоступен при ручном вводе</div>
                  )}
                  
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3 disabled:bg-gray-100 disabled:text-gray-500"
                      value={toLocalDateTimeString(formData.startTime)}
                      disabled={!editingId && formData.timeInputMode === 'timer'}
                      onChange={(e) => handleBreastfeedingManualChange('startTime', fromLocalDateTimeString(e.target.value))}
                    />
                  </div>
                  
                  {editingId && (
                    <>
                      <div>
                        <label className="block mb-2 font-medium">Левая грудь (минут):</label>
                        <input
                          type="number"
                          className="w-full border-2 border-gray-200 rounded-lg p-3"
                          value={formData.manualLeftMinutes || Math.floor((formData.leftDuration || 0) / 60)}
                          onChange={(e) => setFormData(prev => ({ ...prev, manualLeftMinutes: e.target.value }))}
                          placeholder="Введите минуты"
                        />
                      </div>
                      <div>
                        <label className="block mb-2 font-medium">Правая грудь (минут):</label>
                        <input
                          type="number"
                          className="w-full border-2 border-gray-200 rounded-lg p-3"
                          value={formData.manualRightMinutes || Math.floor((formData.rightDuration || 0) / 60)}
                          onChange={(e) => setFormData(prev => ({ ...prev, manualRightMinutes: e.target.value }))}
                          placeholder="Введите минуты"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {selectedActivity === 'bottle' && (
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Чем кормили:</label>
                    <select className="w-full border-2 border-gray-200 rounded-lg p-3" value={formData.foodType || 'breast_milk'} onChange={(e) => setFormData(prev => ({ ...prev, foodType: e.target.value }))}>
                      <option value="breast_milk">Грудное молоко</option>
                      <option value="formula">Смесь</option>
                      <option value="water">Вода</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Количество (мл):</label>
                    <input type="number" className="w-full border-2 border-gray-200 rounded-lg p-3" value={formData.amount || ''} onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))} placeholder="Введите количество мл" />
                  </div>
                </div>
              )}

              {(selectedActivity === 'sleep' || selectedActivity === 'walk' || selectedActivity === 'activity') && (
                <div className="space-y-4">
                  {(() => {
                    const isTimerMode = formData.timeInputMode === 'timer';
                    const isManualMode = formData.timeInputMode === 'manual';

                    return (
                      <>
                  {!editingId && (
                    <div className="border-2 border-indigo-200 rounded-lg p-4">
                      <div className="text-2xl font-mono text-center mb-3">
                        {timers[selectedActivity] ? getTimerDuration(timers[selectedActivity], pausedTimers[selectedActivity]) : formatSeconds(getTotalDuration(selectedActivity))}
                      </div>
                      <button onClick={() => timers[selectedActivity] ? pauseTimer(selectedActivity, selectedActivity) : startTimer(selectedActivity, selectedActivity)} disabled={isManualMode && !timers[selectedActivity]} className={`w-full py-3 rounded-lg flex items-center justify-center ${timers[selectedActivity] ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'} ${(isManualMode && !timers[selectedActivity]) ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        {timers[selectedActivity] ? <><Pause className="w-5 h-5 mr-2" />Остановить</> : <><Play className="w-5 h-5 mr-2" />Запустить таймер</>}
                      </button>
                      {isManualMode && !timers[selectedActivity] && (
                        <div className="text-xs text-center text-gray-500 mt-2">Таймер недоступен при ручном вводе времени</div>
                      )}
                    </div>
                  )}
                  
                  {!editingId && <div className="text-center text-gray-500">или укажите вручную</div>}
                  
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input type="datetime-local" disabled={!editingId && isTimerMode} className="w-full border-2 border-gray-200 rounded-lg p-3 disabled:bg-gray-100 disabled:text-gray-500" value={toLocalDateTimeString(formData.startTime)} onChange={(e) => handleSleepWalkManualChange('startTime', fromLocalDateTimeString(e.target.value))} />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Время окончания:</label>
                    <input type="datetime-local" disabled={!editingId && isTimerMode} className="w-full border-2 border-gray-200 rounded-lg p-3 disabled:bg-gray-100 disabled:text-gray-500" value={toLocalDateTimeString(formData.endTime)} onChange={(e) => handleSleepWalkManualChange('endTime', fromLocalDateTimeString(e.target.value))} />
                  </div>
                  {selectedActivity !== 'activity' && formData.startTime && (
                    <div className="bg-indigo-50 text-indigo-700 rounded-lg p-3 text-sm">
                      Длительность: {formData.endTime ? (formatDuration(formData.startTime, formData.endTime) || 'меньше 1 минуты') : formatSeconds(getTotalDuration(selectedActivity))}
                    </div>
                  )}
                    </>
                    );
                  })()}
                </div>
              )}

              {selectedActivity === 'burp' && (
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 font-medium">Дата и время:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Цвет:</label>
                    <select className="w-full border-2 border-gray-200 rounded-lg p-3" value={formData.burpColor || burpColorOptions[0]} onChange={(e) => setFormData(prev => ({ ...prev, burpColor: e.target.value }))}>
                      {burpColorOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Консистенция:</label>
                    <select className="w-full border-2 border-gray-200 rounded-lg p-3" value={formData.burpConsistency || burpConsistencyOptions[0]} onChange={(e) => setFormData(prev => ({ ...prev, burpConsistency: e.target.value }))}>
                      {burpConsistencyOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Объём:</label>
                    <div className="grid grid-cols-1 gap-3">
                      {burpVolumeOptions.map(option => (
                        <button key={option} onClick={() => setFormData(prev => ({ ...prev, burpVolume: option }))} className={`py-3 rounded-lg border-2 ${formData.burpVolume === option ? 'border-lime-600 bg-lime-50' : 'border-gray-200'}`}>
                          {option === 'less_than_teaspoon' ? 'меньше чайной ложки' : 'больше чайной ложки'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedActivity === 'diaper' && (
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 font-medium">Время:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Тип:</label>
                    <div className="grid grid-cols-2 gap-3">
                      {['wet', 'dirty'].map(type => (
                        <button key={type} onClick={() => setFormData(prev => ({ ...prev, diaperType: type }))} className={`py-3 rounded-lg border-2 ${formData.diaperType === type ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200'}`}>
                          {type === 'wet' ? 'Мокрый' : 'Грязный'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedActivity === 'medicine' && (
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 font-medium">Время:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Название лекарства:</label>
                    <input type="text" className="w-full border-2 border-gray-200 rounded-lg p-3" value={formData.medicineName || ''} onChange={(e) => setFormData(prev => ({ ...prev, medicineName: e.target.value }))} placeholder="Введите название" />
                  </div>
                </div>
              )}

              {selectedActivity === 'bath' && (
                <div>
                  <label className="block mb-2 font-medium">Время начала:</label>
                  <input
                    type="datetime-local"
                    className="w-full border-2 border-gray-200 rounded-lg p-3"
                    value={toLocalDateTimeString(formData.startTime)}
                    onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
                  />
                </div>
              )}

              <div>
                <label className="block mb-2 font-medium">Комментарий:</label>
                <textarea className="w-full border-2 border-gray-200 rounded-lg p-3" rows="3" value={formData.comment || ''} onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))} placeholder="Добавьте заметку..." />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'onboarding') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        <div className="h-16" />

        <div className="max-w-2xl mx-auto px-4">
          <div className="mb-4 bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-2 mb-3">
              <Baby className="w-6 h-6 text-purple-600" />
              <h2 className="text-xl font-semibold">Добро пожаловать!</h2>
            </div>
            <p className="text-gray-600">
              Чтобы начать вести активности, добавьте данные малыша.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Данные малыша</h3>
            <div className="space-y-4">
              <div>
                <label className="block mb-2 font-medium">Имя малыша:</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Введите имя"
                />
              </div>
              <div>
                <label className="block mb-2 font-medium">Дата рождения:</label>
                <input
                  type="date"
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  value={profileForm.birthDate}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, birthDate: e.target.value }))}
                />
                {profileForm.birthDate && (
                  <div className="mt-2 text-sm text-gray-600">
                    Возраст: {calculateAge(profileForm.birthDate)}
                  </div>
                )}
              </div>
              <button
                onClick={saveProfile}
                disabled={isSavingProfile}
                className={`w-full bg-purple-600 text-white py-3 rounded-lg font-medium transition-all ${
                  isSavingProfile ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
                }`}
              >
                {isSavingProfile ? 'Сохранение...' : 'Продолжить'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'profile') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        {/* Отступ для Telegram заголовка */}
        <div className="h-16" />
        
        <div className="max-w-2xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center mb-4 bg-white rounded-2xl shadow-lg p-4">
            <button
              onClick={handleBack}
              className="p-2 rounded-lg bg-gray-100 text-gray-700 active:scale-95 transition-transform mr-2"
              title="Назад"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Baby className="w-6 h-6 mr-2 text-purple-600" />
            <h2 className="text-xl font-semibold">Профиль малыша</h2>
          </div>

          {/* Profile Form */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <h3 className="text-lg font-semibold mb-4">Основная информация</h3>
            <div className="space-y-4">
              <div>
                <label className="block mb-2 font-medium">Имя малыша:</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Введите имя"
                />
              </div>
              <div>
                <label className="block mb-2 font-medium">Дата рождения:</label>
                <input
                  type="date"
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  value={profileForm.birthDate}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, birthDate: e.target.value }))}
                />
                {profileForm.birthDate && (
                  <div className="mt-2 text-sm text-gray-600">
                    Возраст: {calculateAge(profileForm.birthDate)}
                  </div>
                )}
              </div>
              <button
                onClick={saveProfile}
                disabled={isSavingProfile}
                className={`w-full bg-purple-600 text-white py-3 rounded-lg font-medium transition-all ${
                  isSavingProfile ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
                }`}
              >
                {isSavingProfile ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Сохранение...
                  </span>
                ) : (
                  'Сохранить профиль'
                )}
              </button>
            </div>
          </div>

          {/* Growth Tracking */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <h3 className="text-lg font-semibold mb-4">Рост и вес</h3>
            
            {/* Add/Edit Growth Record Form */}
            <div className="space-y-3 mb-4 p-4 bg-purple-50 rounded-lg">
              <div>
                <label className="block mb-2 text-sm font-medium">Дата измерения:</label>
                <input
                  type="date"
                  className="w-full border-2 border-gray-200 rounded-lg p-2"
                  value={growthForm.date}
                  onChange={(e) => setGrowthForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-2 text-sm font-medium">Вес (кг):</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border-2 border-gray-200 rounded-lg p-2"
                    value={growthForm.weight}
                    onChange={(e) => setGrowthForm(prev => ({ ...prev, weight: e.target.value }))}
                    placeholder="3.5"
                  />
                </div>
                <div>
                  <label className="block mb-2 text-sm font-medium">Рост (см):</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full border-2 border-gray-200 rounded-lg p-2"
                    value={growthForm.height}
                    onChange={(e) => setGrowthForm(prev => ({ ...prev, height: e.target.value }))}
                    placeholder="50"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {editingGrowthId && (
                  <button
                    onClick={() => {
                      setEditingGrowthId(null);
                      setGrowthForm({ date: '', weight: '', height: '' });
                    }}
                    className="flex-1 bg-gray-500 text-white py-2 rounded-lg text-sm font-medium active:scale-95 transition-transform"
                  >
                    Отмена
                  </button>
                )}
                <button
                  onClick={addGrowthRecord}
                  disabled={isSavingGrowth}
                  className={`flex-1 bg-purple-600 text-white py-2 rounded-lg text-sm font-medium transition-all ${
                    isSavingGrowth ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
                  }`}
                >
                  {isSavingGrowth ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Сохранение...
                    </span>
                  ) : (
                    editingGrowthId ? 'Обновить' : 'Добавить'
                  )}
                </button>
              </div>
            </div>

            {/* Growth Records List */}
            {growthData.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-medium text-sm text-gray-700 mb-2">История измерений:</h4>
                {growthData.slice().reverse().map((record) => (
                  <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium">
                        {new Date(record.date).toLocaleDateString('ru-RU')}
                      </div>
                      <div className="text-sm text-gray-600">
                        {record.weight && `${record.weight} кг`}
                        {record.weight && record.height && ' • '}
                        {record.height && `${record.height} см`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => editGrowthRecord(record)}
                        className="p-2 hover:bg-white rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4 text-purple-600" />
                      </button>
                      <button
                        onClick={() => deleteGrowthRecord(record.id)}
                        className="p-2 hover:bg-white rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-4">
                Добавьте первое измерение
              </div>
            )}

            {/* Improved Growth Chart with connecting lines */}
            {growthData.length > 1 && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="font-medium text-sm text-gray-700 mb-3">Динамика:</h4>
                <div className="space-y-4">
                  {/* Weight Chart */}
                  {growthData.some(r => r.weight) && (
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-2">Вес (кг)</div>
                      <div className="relative h-32 border-b-2 border-l-2 border-gray-300 pl-2 pb-2">
                        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                          {/* Draw connecting lines */}
                          {growthData.filter(r => r.weight).map((record, idx, arr) => {
                            if (idx === arr.length - 1) return null;
                            
                            const maxWeight = Math.max(...arr.map(r => r.weight));
                            const x1 = (idx / (arr.length - 1)) * 100;
                            const y1 = 100 - (record.weight / maxWeight * 100);
                            const x2 = ((idx + 1) / (arr.length - 1)) * 100;
                            const y2 = 100 - (arr[idx + 1].weight / maxWeight * 100);
                            
                            return (
                              <line
                                key={record.id}
                                x1={`${x1}%`}
                                y1={`${y1}%`}
                                x2={`${x2}%`}
                                y2={`${y2}%`}
                                stroke="#db2777"
                                strokeWidth="2"
                              />
                            );
                          })}
                        </svg>
                        <div className="flex items-end justify-between h-full">
                          {growthData.filter(r => r.weight).map((record) => {
                            const maxWeight = Math.max(...growthData.filter(r => r.weight).map(r => r.weight));
                            const height = (record.weight / maxWeight) * 100;
                            return (
                              <div key={record.id} className="flex flex-col items-center flex-1 mx-1 relative">
                                <div className="text-xs font-semibold mb-1 absolute" style={{ bottom: `${height}%` }}>
                                  {record.weight}
                                </div>
                                <div 
                                  className="w-full bg-pink-400 rounded-t"
                                  style={{ height: `${height}%` }}
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                  {new Date(record.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Height Chart */}
                  {growthData.some(r => r.height) && (
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-2">Рост (см)</div>
                      <div className="relative h-32 border-b-2 border-l-2 border-gray-300 pl-2 pb-2">
                        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                          {/* Draw connecting lines */}
                          {growthData.filter(r => r.height).map((record, idx, arr) => {
                            if (idx === arr.length - 1) return null;
                            
                            const maxHeight = Math.max(...arr.map(r => r.height));
                            const minHeight = Math.min(...arr.map(r => r.height));
                            const x1 = (idx / (arr.length - 1)) * 100;
                            const y1 = 100 - (((record.height - minHeight) / (maxHeight - minHeight)) * 100 || 50);
                            const x2 = ((idx + 1) / (arr.length - 1)) * 100;
                            const y2 = 100 - (((arr[idx + 1].height - minHeight) / (maxHeight - minHeight)) * 100 || 50);
                            
                            return (
                              <line
                                key={record.id}
                                x1={`${x1}%`}
                                y1={`${y1}%`}
                                x2={`${x2}%`}
                                y2={`${y2}%`}
                                stroke="#3b82f6"
                                strokeWidth="2"
                              />
                            );
                          })}
                        </svg>
                        <div className="flex items-end justify-between h-full">
                          {growthData.filter(r => r.height).map((record) => {
                            const maxHeight = Math.max(...growthData.filter(r => r.height).map(r => r.height));
                            const minHeight = Math.min(...growthData.filter(r => r.height).map(r => r.height));
                            const height = ((record.height - minHeight) / (maxHeight - minHeight)) * 100 || 50;
                            return (
                              <div key={record.id} className="flex flex-col items-center flex-1 mx-1 relative">
                                <div className="text-xs font-semibold mb-1 absolute" style={{ bottom: `${height}%` }}>
                                  {record.height}
                                </div>
                                <div 
                                  className="w-full bg-blue-400 rounded-t"
                                  style={{ height: `${height}%`, minHeight: '20%' }}
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                  {new Date(record.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'stats') {
    // Get start of current week (Monday)
    const getWeekStart = (offset = 0) => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as first day
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff + (offset * 7));
      monday.setHours(0, 0, 0, 0);
      return monday;
    };

    const weekStart = getWeekStart(selectedWeekOffset);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      return day;
    });

    const getIndicatorColorClass = (type) => {
      const colorClass = activityTypes[type]?.color || '';

      if (colorClass.includes('pink')) return 'bg-pink-400';
      if (colorClass.includes('blue')) return 'bg-blue-400';
      if (colorClass.includes('indigo')) return 'bg-indigo-400';
      if (colorClass.includes('cyan')) return 'bg-cyan-400';
      if (colorClass.includes('green')) return 'bg-green-400';
      if (colorClass.includes('yellow')) return 'bg-yellow-400';
      if (colorClass.includes('orange')) return 'bg-orange-400';
      if (colorClass.includes('lime')) return 'bg-lime-400';
      if (colorClass.includes('red')) return 'bg-red-400';

      return 'bg-gray-400';
    };

    const indicatorColors = {
      breastfeeding: '#ec4899',
      bottle: '#3b82f6',
      sleep: '#6366f1',
      bath: '#06b6d4',
      walk: '#22c55e',
      activity: '#f97316',
      burp: '#84cc16',
      diaper: '#eab308',
      medicine: '#ef4444',
    };

    const getCellSummary = (day, hour) => {
      const hourStart = new Date(day);
      hourStart.setHours(hour, 0, 0, 0);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      const minutesByType = {};

      activities.forEach((activity) => {
        if (!activity.startTime) return;

        const startTime = new Date(activity.startTime);
        const fallbackEnd = new Date(startTime.getTime() + 10 * 60 * 1000);
        const rawEndTime = activity.endTime ? new Date(activity.endTime) : fallbackEnd;
        const endTime = rawEndTime > startTime ? rawEndTime : new Date(startTime.getTime() + 5 * 60 * 1000);

        if (endTime <= hourStart || startTime >= hourEnd) return;

        const segmentStart = startTime < hourStart ? hourStart : startTime;
        const segmentEnd = endTime > hourEnd ? hourEnd : endTime;
        const durationMinutes = Math.max(0, (segmentEnd - segmentStart) / 60000);

        minutesByType[activity.type] = (minutesByType[activity.type] || 0) + durationMinutes;
      });

      const dominantType = Object.entries(minutesByType)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const totalMinutes = Math.min(60, Object.values(minutesByType).reduce((sum, minutes) => sum + minutes, 0));

      return {
        dominantType,
        fillPercent: Math.round((totalMinutes / 60) * 100),
      };
    };

    const formatWeekRange = () => {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return `${weekStart.getDate()} ${weekStart.toLocaleDateString('ru-RU', { month: 'short' })} - ${weekEnd.getDate()} ${weekEnd.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}`;
    };

    // Get summary statistics for the week
    const getWeekStats = () => {
      const weekActivities = activities.filter(a => {
        const activityDate = new Date(a.startTime);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        return activityDate >= weekStart && activityDate < weekEnd;
      });

      const stats = {};
      weekActivities.forEach(activity => {
        if (!stats[activity.type]) {
          stats[activity.type] = { count: 0, totalDuration: 0 };
        }
        stats[activity.type].count++;
        
        if (activity.startTime && activity.endTime) {
          stats[activity.type].totalDuration += new Date(activity.endTime) - new Date(activity.startTime);
        } else if (activity.type === 'breastfeeding') {
          stats[activity.type].totalDuration += (activity.leftDuration + activity.rightDuration) * 1000;
        }
      });

      return Object.fromEntries(
        Object.entries(stats).map(([type, data]) => [
          type,
          {
            ...data,
            avgCountPerDay: data.count / 7,
            avgDurationPerDay: data.totalDuration / 7,
          },
        ])
      );
    };

    const formatAverageCount = (value) => {
      const rounded = Math.round(value * 10) / 10;
      return Number.isInteger(rounded)
        ? `${rounded}`
        : rounded.toFixed(1).replace('.', ',');
    };

    const weekStats = getWeekStats();
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        {/* Отступ для Telegram заголовка */}
        <div className="h-16" />
        
        <div className="max-w-7xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center mb-4 bg-white rounded-2xl shadow-lg p-4">
            <button
              onClick={handleBack}
              className="p-2 rounded-lg bg-gray-100 text-gray-700 active:scale-95 transition-transform mr-2"
              title="Назад"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <BarChart3 className="w-6 h-6 mr-2 text-purple-600" />
            <h2 className="text-xl font-semibold">Статистика</h2>
          </div>

          {/* Week Navigation */}
          <div className="bg-white rounded-2xl shadow-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  setSelectedWeekOffset(prev => prev - 1);
                  if (tg) tg.HapticFeedback?.impactOccurred('light');
                }}
                className="p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="text-center">
                <div className="font-semibold text-lg">{formatWeekRange()}</div>
                {selectedWeekOffset === 0 && <div className="text-sm text-gray-500">Текущая неделя</div>}
              </div>
              <button
                onClick={() => {
                  setSelectedWeekOffset(prev => prev + 1);
                  if (tg) tg.HapticFeedback?.impactOccurred('light');
                }}
                className="p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200"
                disabled={selectedWeekOffset >= 0}
              >
                <ArrowLeft className="w-5 h-5 rotate-180" style={{ opacity: selectedWeekOffset >= 0 ? 0.3 : 1 }} />
              </button>
            </div>
          </div>

          {/* Timeline Table */}
          <div className="bg-white rounded-2xl shadow-lg p-4 mb-4 overflow-x-auto">
            <div>
              <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-1.5 mb-2">
                <div className="text-[11px] text-gray-400 font-semibold uppercase text-center pt-1">Час</div>
                {weekDays.map((day, i) => (
                  <div key={i} className="text-center leading-tight">
                    <div className="text-xs font-semibold text-gray-600 uppercase">{day.toLocaleDateString('ru-RU', { weekday: 'short' })}</div>
                    <div className="text-xs text-gray-400">{day.getDate()}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] gap-1.5 items-center">
                    <div className="text-[12px] text-gray-400 text-center">{hour.toString().padStart(2, '0')}</div>
                    {weekDays.map((day, dayIndex) => {
                      const { dominantType, fillPercent } = getCellSummary(day, hour);
                      const fillColor = dominantType ? indicatorColors[dominantType] : '#e5e7eb';
                      const title = dominantType
                        ? `${activityTypes[dominantType]?.label || 'Активность'} · занято ${fillPercent}% часа`
                        : 'Нет активности';

                      return (
                        <div
                          key={`${hour}-${dayIndex}`}
                          className="h-8 rounded-md border border-gray-100"
                          style={{
                            background: fillPercent > 0
                              ? `linear-gradient(to top, ${fillColor} 0%, ${fillColor} ${fillPercent}%, #e5e7eb ${fillPercent}%, #e5e7eb 100%)`
                              : '#e5e7eb',
                          }}
                          title={title}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="bg-white rounded-2xl shadow-lg p-4 mb-4">
            <h3 className="text-sm font-semibold mb-3 text-gray-700">Легенда</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(activityTypes).map(([key, data]) => {
                const Icon = data.icon;
                return (
                  <div key={key} className="rounded-lg p-2 border border-gray-100 flex items-center gap-2 bg-white">
                    <span className={`w-2.5 h-2.5 rounded-full ${getIndicatorColorClass(key)}`} />
                    <Icon className="w-4 h-4 flex-shrink-0 text-gray-500" />
                    <span className="text-xs font-medium text-gray-700">{data.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Week Summary Statistics */}
          <div className="bg-white rounded-2xl shadow-lg p-4">
            <h3 className="text-sm font-semibold mb-3 text-gray-700">Сводка за неделю</h3>
            {Object.keys(weekStats).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(weekStats).map(([type, data]) => {
                  const ActivityIcon = activityTypes[type]?.icon;
                  const duration = formatDuration(0, data.avgDurationPerDay);
                  return (
                    <div key={type} className={`${activityTypes[type]?.color} rounded-lg p-3`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {ActivityIcon && <ActivityIcon className="w-5 h-5" />}
                          <span className="font-semibold">{activityTypes[type]?.label}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatAverageCount(data.avgCountPerDay)} раз/день</div>
                          {duration && (
                            <div className="text-sm opacity-75">
                              {duration}/день
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-4">На этой неделе нет записей</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'notifications') {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Загрузка уведомлений...</div>}>
        <NotificationsView
          tg={tg}
          onBack={() => {
            if (tg) tg.HapticFeedback?.impactOccurred('light');
            setView('main');
          }}
          activityTypes={activityTypes}
          notificationHelpers={notificationHelpers}
          isAuthenticated={isAuthenticated}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-6">
      {/* Отступ для Telegram заголовка */}
      <div className="h-14" />
      
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 bg-white rounded-2xl shadow-lg p-4">
          <div className="flex items-center">
            <Baby className="w-6 h-6 mr-2 text-purple-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-800">
                {babyProfile.name || 'Трекер малыша'}
              </h1>
              {isAuthenticated && (
                <div className="flex items-center text-xs text-green-600 mt-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></div>
                  Синхронизировано
                </div>
              )}
              {!isAuthenticated && (
                <div className="flex items-center text-xs text-gray-500 mt-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full mr-1"></div>
                  Локальное хранилище
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => { 
                if (tg) tg.HapticFeedback?.impactOccurred('light'); 
                setView('profile'); 
              }} 
              className="bg-purple-500 text-white p-3 rounded-lg active:scale-95 transition-transform"
              title="Профиль малыша"
            >
              <Baby className="w-5 h-5" />
            </button>
            
            <button 
              onClick={() => { 
                if (tg) tg.HapticFeedback?.impactOccurred('light'); 
                setView('notifications'); 
              }} 
              className="bg-purple-500 text-white p-3 rounded-lg active:scale-95 transition-transform"
              title="Уведомления"
            >
              <Bell className="w-5 h-5" />
            </button>
            
            <button 
              onClick={() => { 
                if (tg) tg.HapticFeedback?.impactOccurred('light'); 
                setView('stats'); 
              }} 
              className="bg-purple-500 text-white p-3 rounded-lg active:scale-95 transition-transform"
              title="Статистика"
            >
              <BarChart3 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {activeTimers.length > 0 && (
          <div className="mb-4 bg-white rounded-2xl shadow-lg p-4">
            <h3 className="text-sm font-semibold mb-3 text-gray-700">Активные таймеры</h3>
            <div className="space-y-2">
              {activeTimers.map((timer, idx) => {
                const ActivityIcon = activityTypes[timer.type].icon;
                return (
                  <button
                    key={idx}
                    onClick={() => continueActivity(timer.type)}
                    className={`w-full ${activityTypes[timer.type].color} rounded-lg p-3 flex items-center justify-between active:scale-95 transition-transform`}
                  >
                    <div className="flex items-center">
                      <ActivityIcon className="w-5 h-5 mr-3" />
                      <span className="font-medium">{activityTypes[timer.type].label}</span>
                    </div>
                    <div className="text-lg font-mono">
                      {timer.type === 'breastfeeding' 
                        ? `Л:${Math.floor(timer.leftTime / 60)}м / П:${Math.floor(timer.rightTime / 60)}м`
                        : formatSeconds(timer.time)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(activityTypes).map(([key, data]) => {
              const Icon = data.icon;
              const timeSince = getTimeSinceLastActivity(key);
              return (
                <button key={key} onClick={() => startActivity(key)} className={`${data.color} p-4 rounded-lg flex flex-col items-center justify-center transition-transform active:scale-95 relative`}>
                  <Icon className="w-8 h-8 mb-2" />
                  <span className="text-sm font-medium text-center">{data.label}</span>
                  {timeSince && (
                    <span className="text-xs opacity-75 mt-1 text-center">{timeSince}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Последние записи ({recentCompletedActivities.length})</h2>
          <div className="space-y-3">
            {recentCompletedActivities.slice(0, 10).map(activity => {
              const ActivityIcon = activityTypes[activity.type].icon;
              const duration = activity.startTime && activity.endTime ? formatDuration(activity.startTime, activity.endTime) : '';
              
              return (
                <div key={activity.id} className={`${activityTypes[activity.type].color} rounded-lg p-3`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start flex-1 min-w-0">
                      <ActivityIcon className="w-5 h-5 mr-3 mt-1 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{activityTypes[activity.type].label}</div>
                        <div className="text-sm opacity-75">
                          {activity.startTime && formatTime(activity.startTime)}
                          {duration && ` - ${formatTime(activity.endTime)} (${duration})`}
                        </div>
                        {activity.type === 'breastfeeding' && (
                          <div className="text-sm opacity-75">Л: {Math.floor(activity.leftDuration / 60)}м, П: {Math.floor(activity.rightDuration / 60)}м</div>
                        )}
                        {activity.type === 'burp' ? (
                          <>
                            {activity.burpColor && <div className="text-sm opacity-75">Цвет: {activity.burpColor}</div>}
                            {activity.burpConsistency && <div className="text-sm opacity-75">Консистенция: {activity.burpConsistency}</div>}
                            {activity.burpVolume && <div className="text-sm opacity-75">Объём: {activity.burpVolume === 'less_than_teaspoon' ? 'меньше чайной ложки' : 'больше чайной ложки'}</div>}
                          </>
                        ) : (
                          <>
                            {activity.foodType && (
                              <div className="text-sm opacity-75">{activity.foodType === 'breast_milk' ? 'Грудное молоко' : activity.foodType === 'formula' ? 'Смесь' : 'Вода'}</div>
                            )}
                            {activity.amount && <div className="text-sm opacity-75">Количество: {activity.amount} мл</div>}
                            {activity.diaperType && <div className="text-sm opacity-75">{activity.diaperType === 'wet' ? 'Мокрый' : 'Грязный'}</div>}
                            {activity.medicineName && <div className="text-sm opacity-75">{activity.medicineName}</div>}
                          </>
                        )}
                        {activity.comment && <div className="text-sm opacity-75 mt-1">{activity.comment}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-2">
                      <button
                        onClick={() => editActivity(activity)}
                        className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteActivity(activity.id)}
                        className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {recentCompletedActivities.length === 0 && (
              <div className="text-center text-gray-500 py-8">Добавьте первую запись</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityTracker;
