import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Baby, Milk, Moon, Bath, Wind, Droplets, Pill, BarChart3, ArrowLeft, Play, Pause, Edit2, Trash2, X, Bell, Activity, Undo2 } from 'lucide-react';
import * as supabaseModule from './utils/supabase.js';

// ============================================
// 🔥 НОВЫЕ ИМПОРТЫ - ДОБАВЬТЕ ЗДЕСЬ
// ============================================
import { Platform, mockCapacitor } from './utils/platform';
import cacheService from './services/cacheService';
import supabaseService from './services/supabaseService';
import notificationService from './services/notificationService';
// ============================================

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
  const [growthData, setGrowthData] = useState([]);
  const [profileForm, setProfileForm] = useState({ name: '', birthDate: '', photo: null });
  const [growthForm, setGrowthForm] = useState({ date: '', weight: '', height: '' });
  const [editingGrowthId, setEditingGrowthId] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingGrowth, setIsSavingGrowth] = useState(false);
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

  const fromLocalDateTimeString = (localString) => {
    if (!localString) return '';
    const date = new Date(localString);
    return date.toISOString();
  };

  const formatDuration = (start, end) => {
    const diff = new Date(end) - new Date(start);
    const minutes = Math.floor(diff / 60000);
    
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

  const convertFromSupabaseActivity = (dbActivity) => {
    const parsedBurpComment = dbActivity.type === 'burp'
      ? parseBurpComment(dbActivity.comment)
      : null;

    return {
      id: dbActivity.id,
      type: dbActivity.type,
      startTime: dbActivity.start_time,
      endTime: dbActivity.end_time,
      comment: parsedBurpComment?.comment ?? dbActivity.comment,
      date: new Date(dbActivity.start_time).toLocaleDateString('ru-RU'),
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

  const convertToSupabaseActivity = (activity) => {
    const isBurp = activity.type === 'burp';

    return {
      type: activity.type,
      startTime: activity.startTime,
      endTime: activity.endTime,
      comment: isBurp
        ? serializeBurpComment(activity.comment, activity)
        : activity.comment,
      leftDuration: activity.leftDuration,
      rightDuration: activity.rightDuration,
      foodType: isBurp ? null : activity.foodType,
      amount: activity.type === 'bottle' && activity.amount ? parseInt(activity.amount, 10) : null,
      diaperType: isBurp ? null : activity.diaperType,
      medicineName: isBurp ? null : activity.medicineName,
    };
  };

  const convertFromSupabaseGrowth = (dbRecord) => {
    return {
      id: dbRecord.id,
      date: dbRecord.measurement_date,
      weight: dbRecord.weight,
      height: dbRecord.height,
    };
  };

  // ============================================
  // 🔥 ОБНОВЛЁННАЯ ФУНКЦИЯ loadData с кешированием
  // ============================================
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    
    // Инициализируем мок Capacitor для браузерного тестирования
    if (!Platform.isTelegram() && !Platform.isAndroid()) {
      mockCapacitor();
    }
    
    const loadTimeout = setTimeout(() => {
      console.warn('Load timeout - falling back to localStorage');
      setAuthError('Превышено время ожидания');
      loadFromLocalStorage();
      setIsLoading(false);
    }, 10000);
    
    try {
      const hasSupabase =
        supabaseModule.isSupabaseConfigured &&
        supabaseModule.authHelpers &&
        typeof supabaseModule.authHelpers.signInWithTelegram === 'function';

      if (hasSupabase && Platform.isTelegram()) {
        const telegramUser = window.Telegram.WebApp.initDataUnsafe.user;

        try {
          const { error } = await supabaseModule.authHelpers.signInWithTelegram(telegramUser);

          if (error) {
            console.error('Auth error:', error);
            setAuthError('Ошибка аутентификации - используется localStorage');
            loadFromLocalStorage();
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
          }

          setIsAuthenticated(true);

          // 🔥 Используем кеширование для загрузки данных
          try {
            const user = await supabaseModule.authHelpers.getCurrentUser();
            
            // Получаем baby_id сначала
            const { data: babyData } = await supabaseModule.supabase
              .from('babies')
              .select('*')
              .eq('user_id', user.id)
              .maybeSingle();

            if (babyData) {
              setBabyProfile({
                name: babyData.name || '',
                birthDate: babyData.birth_date || '',
                photo: babyData.photo_url || null,
              });

              // Загружаем activities и growth с кешированием
              const [activities, growth] = await Promise.all([
                supabaseService.getWithCache('activities', {
                  eq: { baby_id: babyData.id },
                  order: { column: 'start_time', ascending: false },
                  limit: 100
                }, 1800), // 30 минут кеш
                supabaseService.getWithCache('growth_records', {
                  eq: { baby_id: babyData.id },
                  order: { column: 'measurement_date', ascending: true }
                }, 86400) // 24 часа кеш
              ]);

              if (activities.data) {
                setActivities(activities.data.map(convertFromSupabaseActivity));
                if (activities.fromCache) {
                  console.log('⚡ Activities loaded from cache');
                }
              }

              if (growth.data) {
                setGrowthData(growth.data.map(convertFromSupabaseGrowth));
                if (growth.fromCache) {
                  console.log('⚡ Growth data loaded from cache');
                }
              }
            }
          } catch (err) {
            console.error('Initial data load error:', err);
          }

          // Загружаем таймеры из localStorage
          const savedTimers = localStorage.getItem('active_timers');
          const savedPaused = localStorage.getItem('paused_timers');
          const savedTimerMeta = localStorage.getItem('timer_meta');
          if (savedTimers) setTimers(JSON.parse(savedTimers));
          if (savedPaused) setPausedTimers(JSON.parse(savedPaused));
          if (savedTimerMeta) setTimerMeta(JSON.parse(savedTimerMeta));
        } catch (supabaseError) {
          console.error('Supabase error:', supabaseError);
          setAuthError('Supabase недоступен - используется localStorage');
          loadFromLocalStorage();
        }
      } else {
        console.log('Using localStorage (no Telegram or Supabase config)');
        loadFromLocalStorage();
      }
    } catch (error) {
      console.error('Load data error:', error);
      setAuthError('Ошибка загрузки данных');
      loadFromLocalStorage();
    } finally {
      clearTimeout(loadTimeout);
      setIsLoading(false);
    }
  }, []);

  const loadFromLocalStorage = () => {
    const savedActivities = localStorage.getItem('baby_activities');
    const savedTimers = localStorage.getItem('active_timers');
    const savedPaused = localStorage.getItem('paused_timers');
    const savedTimerMeta = localStorage.getItem('timer_meta');
    const savedProfile = localStorage.getItem('baby_profile');
    const savedGrowth = localStorage.getItem('growth_data');
    
    if (savedActivities) setActivities(JSON.parse(savedActivities));
    if (savedTimers) setTimers(JSON.parse(savedTimers));
    if (savedPaused) setPausedTimers(JSON.parse(savedPaused));
    if (savedTimerMeta) setTimerMeta(JSON.parse(savedTimerMeta));
    if (savedProfile) setBabyProfile(JSON.parse(savedProfile));
    if (savedGrowth) setGrowthData(JSON.parse(savedGrowth));
  };

  const getActivityChronologyTime = useCallback((activity) => {
    if (!activity) return 0;
    const preferredTime = activity.startTime || activity.endTime;
    const parsed = new Date(preferredTime).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const activitiesByChronology = useMemo(() => {
    return [...activities].sort((a, b) => getActivityChronologyTime(b) - getActivityChronologyTime(a));
  }, [activities, getActivityChronologyTime]);

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
    if (isSaving) {
      console.log('Already saving, ignoring duplicate request');
      return;
    }
    
    setIsSaving(true);
    
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
    
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
        const supabaseData = convertToSupabaseActivity(activityData);
        
        if (editingId) {
          const { data, error } = await supabaseModule.activityHelpers.updateActivity(editingId, supabaseData);
          if (error) throw error;
          setActivities(prev => prev.map(a => a.id === editingId ? convertFromSupabaseActivity(data) : a));
          
          // 🔥 Инвалидируем кеш activities
          await cacheService.remove('activities_*');
        } else {
          const { data, error } = await supabaseModule.activityHelpers.createActivity(supabaseData);
          if (error) throw error;
          setActivities(prev => [convertFromSupabaseActivity(data), ...prev]);
          
          // 🔥 Инвалидируем кеш activities
          await cacheService.remove('activities_*');
        }
      } else {
        if (editingId) {
          const updatedActivities = activities.map(a => a.id === editingId ? activityData : a);
          setActivities(updatedActivities);
          localStorage.setItem('baby_activities', JSON.stringify(updatedActivities));
        } else {
          const updatedActivities = [activityData, ...activities];
          setActivities(updatedActivities);
          localStorage.setItem('baby_activities', JSON.stringify(updatedActivities));
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
  }, [formData, tg, timers, pausedTimers, timerMeta, editingId, getTotalDuration, resetTimer, isAuthenticated, activities, isSaving]);

  const deleteActivity = async (id) => {
    if (tg) tg.HapticFeedback?.notificationOccurred('warning');
    if (window.confirm('Удалить эту запись?')) {
      try {
        if (isAuthenticated) {
          const { error } = await supabaseModule.activityHelpers.deleteActivity(id);
          if (error) throw error;
          
          // 🔥 Инвалидируем кеш
          await cacheService.remove('activities_*');
        } else {
          localStorage.setItem('baby_activities', JSON.stringify(activities.filter(a => a.id !== id)));
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
    
    if (timers.left || timers.right || pausedTimers.left || pausedTimers.right) {
      activeTimers.push({ 
        type: 'breastfeeding', 
        timers: ['left', 'right'],
        leftTime: getTotalDuration('left'),
        rightTime: getTotalDuration('right')
      });
    }
    
    if (timers.sleep || pausedTimers.sleep) {
      activeTimers.push({ 
        type: 'sleep', 
        timers: ['sleep'],
        time: getTotalDuration('sleep')
      });
    }
    
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

  // ============================================
  // 🔥 ПЕРВЫЙ useEffect - инициализация Telegram
  // ============================================
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
  }, []);

  // ============================================
  // 🔥 ВТОРОЙ useEffect - загрузка данных и инициализация уведомлений
  // ============================================
  useEffect(() => {
    const init = async () => {
      await loadData();
      
      // Инициализируем уведомления после загрузки данных
      if (Platform.isAndroid() || Platform.isTelegram()) {
        try {
          await notificationService.initialize();
          console.log('✅ Notifications initialized');
        } catch (error) {
          console.error('Failed to initialize notifications:', error);
        }
      }
    };
    
    init();
  }, [loadData]);

  useEffect(() => {
    if (!tg) return;

    if (view === 'main') {
      tg.BackButton.hide();
      tg.MainButton.hide();
    } else {
      tg.BackButton.show();
      tg.BackButton.onClick(handleBack);
      
      if (view === 'add') {
        if (isSaving) {
          tg.MainButton.setText('Сохранение...');
          tg.MainButton.showProgress(false);
          tg.MainButton.disable();
        } else {
          tg.MainButton.setText(editingId ? 'Обновить' : 'Сохранить');
          tg.MainButton.hideProgress();
          tg.MainButton.enable();
        }
        tg.MainButton.show();
        tg.MainButton.onClick(saveActivity);
      } else {
        tg.MainButton.hide();
      }
    }

    return () => {
      tg.BackButton.offClick(handleBack);
      tg.MainButton.offClick(saveActivity);
    };
  }, [view, tg, handleBack, saveActivity, editingId, isSaving]);

  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem('active_timers', JSON.stringify(timers));
      localStorage.setItem('paused_timers', JSON.stringify(pausedTimers));
      localStorage.setItem('timer_meta', JSON.stringify(timerMeta));
    }
  }, [timers, pausedTimers, timerMeta, isLoading]);

  useEffect(() => {
    const interval = setInterval(() => setTimers(prev => ({ ...prev })), 1000);
    return () => clearInterval(interval);
  }, []);

  const [, setRefreshTrigger] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (view === 'profile') {
      setProfileForm(babyProfile);
    }
  }, [view, babyProfile]);

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

  const getTimeSinceLastActivity = (type) => {
    const typeActivities = activitiesByChronology.filter(a => a.type === type);
    if (typeActivities.length === 0) return null;

    const lastActivity = typeActivities[0];
    const lastTime = lastActivity.startTime || lastActivity.endTime;
    if (!lastTime) return null;
    
    const now = Date.now();
    const lastTimeMs = new Date(lastTime).getTime();
    const diffMs = now - lastTimeMs;
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
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

  const saveProfile = useCallback(async () => {
    if (isSavingProfile) return;
    
    setIsSavingProfile(true);
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
    
    try {
      if (isAuthenticated) {
        const { data, error } = await supabaseModule.babyHelpers.upsertProfile({
          name: profileForm.name,
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
        setBabyProfile(profileForm);
        localStorage.setItem('baby_profile', JSON.stringify(profileForm));
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
    if (isSavingGrowth) return;
    
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
        
        // 🔥 Инвалидируем кеш growth
        await cacheService.remove('growth_records_*');
      } else {
        if (editingGrowthId) {
          const updatedGrowthData = growthData.map(r => r.id === editingGrowthId ? record : r);
          setGrowthData(updatedGrowthData);
          localStorage.setItem('growth_data', JSON.stringify(updatedGrowthData));
        } else {
          const updatedGrowthData = [...growthData, record].sort((a, b) => new Date(a.date) - new Date(b.date));
          setGrowthData(updatedGrowthData);
          localStorage.setItem('growth_data', JSON.stringify(updatedGrowthData));
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
          
          // 🔥 Инвалидируем кеш
          await cacheService.remove('growth_records_*');
        } else {
          localStorage.setItem('growth_data', JSON.stringify(growthData.filter(r => r.id !== id)));
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

  // ============================================
  // 🔥 КОМПОНЕНТ CACHE DEBUG (только в dev режиме)
  // ============================================
  const CacheDebug = () => {
    const [stats, setStats] = useState(null);
    const [show, setShow] = useState(false);
    
    const loadStats = async () => {
      const s = await cacheService.getStats();
      setStats(s);
    };
    
    useEffect(() => {
      if (show) {
        loadStats();
      }
    }, [show]);
    
    if (!show) {
      return (
        <button
          onClick={() => setShow(true)}
          className="fixed bottom-20 right-4 bg-gray-800 text-white px-3 py-2 rounded-lg text-xs z-50 shadow-lg"
        >
          📊 Cache
        </button>
      );
    }
    
    return (
      <div className="fixed bottom-20 right-4 bg-white rounded-lg shadow-xl p-4 z-50 max-w-xs border-2 border-gray-200">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-semibold text-sm">Cache Stats</h4>
          <button onClick={() => setShow(false)} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>
        
        {stats && (
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600">Platform:</span>
              <strong>{stats.platform}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Total Keys:</span>
              <strong>{stats.totalKeys}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Valid:</span>
              <strong className="text-green-600">{stats.validKeys}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Expired:</span>
              <strong className="text-orange-600">{stats.expiredKeys}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Size:</span>
              <strong>{stats.totalSizeMB} MB</strong>
            </div>
          </div>
        )}
        
        <div className="mt-3 space-y-2">
          <button
            onClick={async () => {
              const cleaned = await cacheService.cleanExpired();
              alert(`Очищено ${cleaned} записей`);
              loadStats();
            }}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-xs font-medium transition-colors"
          >
            🧹 Clean Expired
          </button>
          
          <button
            onClick={async () => {
              if (confirm('Очистить весь кеш?')) {
                await cacheService.clear();
                alert('Кеш очищен');
                loadStats();
              }
            }}
            className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded text-xs font-medium transition-colors"
          >
            🗑️ Clear All Cache
          </button>
          
          <button
            onClick={loadStats}
            className="w-full bg-gray-500 hover:bg-gray-600 text-white py-2 rounded text-xs font-medium transition-colors"
          >
            🔄 Refresh Stats
          </button>
        </div>
      </div>
    );
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

  // ... [Здесь весь остальной код view === 'add', view === 'profile', view === 'stats', view === 'notifications' остаётся БЕЗ ИЗМЕНЕНИЙ] ...
  // Я пропускаю его для краткости, так как он не меняется

  // В конце return основного компонента добавьте Cache Debug:
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
          <h2 className="text-lg font-semibold mb-4">Последние записи ({activities.length})</h2>
          <div className="space-y-3">
            {activitiesByChronology.slice(0, 10).map(activity => {
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
            {activities.length === 0 && (
              <div className="text-center text-gray-500 py-8">Добавьте первую запись</div>
            )}
          </div>
        </div>
      </div>
      
      {/* 🔥 Cache Debug Component - показывать только в development */}
      {process.env.NODE_ENV === 'development' && <CacheDebug />}
    </div>
  );
};

export default ActivityTracker;