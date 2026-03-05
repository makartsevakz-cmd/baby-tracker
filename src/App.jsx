import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Baby, Milk, Moon, Bath, Wind, Droplets, Pill, BarChart3, ArrowLeft, Play, Pause, Edit2, Trash2, X, Bell, Activity, Undo2, Home, History, ChevronRight, Settings as SettingsIcon } from 'lucide-react';
import * as supabaseModule from './utils/supabase.js';
import ENV from './config/environment';
import cacheService, { CACHE_TTL_SECONDS } from './services/cacheService.js';
import supabaseService from './services/supabaseService.js';
import notificationService from './services/notificationService.js';
import userSettingsService, { DEFAULT_USER_SETTINGS } from './services/userSettingsService.js';
import { Platform } from './utils/platform.js';
import StatsActivityDetail from './components/stats/StatsActivityDetail.jsx';
const NotificationsView = lazy(() => import('./components/NotificationsView.jsx'));
const SettingsView = lazy(() => import('./components/SettingsView.jsx'));
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';

// Debounce helper для throttling
function debounce(func, wait) {
  let timeout;

  const debounced = function executedFunction(...args) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}

const buildUserNamespace = (user, telegramUser) => {
  if (user?.id) {
    return `user_${user.id}`;
  }

  if (telegramUser?.id) {
    return `telegram_${telegramUser.id}`;
  }

  return 'global';
};

const getTodayDateString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  const [isInitializing, setIsInitializing] = useState(true); // 🔧 ИСПРАВЛЕНИЕ: Флаг инициализации для блокировки автосохранения
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [historyTab, setHistoryTab] = useState('list');
  const [historyVisibleDayCount, setHistoryVisibleDayCount] = useState(7);
  const [historyFilterTypes, setHistoryFilterTypes] = useState([]);
  const [historyFilterStartDate, setHistoryFilterStartDate] = useState('');
  const [historyFilterEndDate, setHistoryFilterEndDate] = useState('');
  const [selectedStatsActivityType, setSelectedStatsActivityType] = useState(null);
  const [selectedStatsWeekStart, setSelectedStatsWeekStart] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 10);
  });
  const [babyProfile, setBabyProfile] = useState({
    name: '',
    birthDate: '',
    photo: null
  });
  const [growthData, setGrowthData] = useState([]); // Array of {date, weight, height}
  const [profileForm, setProfileForm] = useState({ name: '', birthDate: '', photo: null });
  const [growthForm, setGrowthForm] = useState({ date: getTodayDateString(), weight: '', height: '' });
  const [editingGrowthId, setEditingGrowthId] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [userSettings, setUserSettings] = useState(DEFAULT_USER_SETTINGS);
  const [authError, setAuthError] = useState(null);
  const [isSaving, setIsSaving] = useState(false); // Prevent double saves
  const [isSavingProfile, setIsSavingProfile] = useState(false); // Profile save state
  const [isSavingGrowth, setIsSavingGrowth] = useState(false); // Growth save state
  const [notificationHelpers, setNotificationHelpers] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [isOnboardingCompleted, setIsOnboardingCompleted] = useState(false);
  const [isOnboardingStatusResolved, setIsOnboardingStatusResolved] = useState(false);
  const activeNamespaceRef = useRef('global');
  const timersRef = useRef({});
  const pausedTimersRef = useRef({});
  const timerMetaRef = useRef({});
  const historyLoadTriggerRef = useRef(null);
  // НОВЫЕ СОСТОЯНИЯ ДЛЯ АВТОРИЗАЦИИ
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' или 'register'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authFormError, setAuthFormError] = useState('');
  const [telegramUserRef, setTelegramUserRef] = useState(null);

  const activityTypes = {
    breastfeeding: { icon: Baby, label: 'Кормление грудью', color: 'bg-pink-100 text-pink-600' },
    bottle: { icon: Milk, label: 'Бутылочка', color: 'bg-blue-100 text-blue-600' },
    sleep: { icon: Moon, label: 'Сон', color: 'bg-indigo-100 text-indigo-600' },
    bath: { icon: Bath, label: 'Купание', color: 'bg-cyan-100 text-cyan-600' },
    walk: { icon: Wind, label: 'Прогулка', color: 'bg-green-100 text-green-600' },
    activity: { icon: Activity, label: 'Активность', color: 'bg-orange-100 text-orange-600' },
    custom: { icon: Edit2, label: 'Свое событие', color: 'bg-violet-100 text-violet-700' },
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

  const parseDurationInputToSeconds = (value) => {
    if (!value) return 0;

    const raw = String(value).trim();
    if (!raw) return 0;

    const parts = raw.split(':').map(part => part.trim());
    if (parts.some(part => part === '' || Number.isNaN(Number(part)))) {
      return 0;
    }

    const normalized = parts.map(part => Math.max(0, parseInt(part, 10) || 0));

    if (normalized.length === 1) {
      return normalized[0];
    }

    if (normalized.length === 2) {
      return normalized[0] * 60 + normalized[1];
    }

    const [hours, minutes, seconds] = normalized.slice(-3);
    return (hours * 3600) + (minutes * 60) + seconds;
  };

  const isTimerActivity = (type) => ['sleep', 'walk', 'activity'].includes(type);

  const getDurationSecondsFromTimeRange = (startTime, endTime, useNowAsEnd = true) => {
    const parsedStart = startTime ? new Date(startTime).getTime() : Number.NaN;
    if (!Number.isFinite(parsedStart)) return 0;

    const parsedEnd = endTime ? new Date(endTime).getTime() : (useNowAsEnd ? Date.now() : Number.NaN);
    if (!Number.isFinite(parsedEnd)) return 0;

    return Math.max(0, Math.floor((parsedEnd - parsedStart) / 1000));
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

    if (normalized === 'started_from:app_timer') {
      return 'Запущенная активность ⏰';
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
      baby_id: babyProfile.id, // ⬅️ ДОБАВЛЕНО - КРИТИЧНО!
      user_id: currentUser?.id, // ⬅️ ДОБАВИТЬ эту строку
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

    // В loadFromCache, примерно строка 288
  const reconstructTimersFromActivities = useCallback((rawActivities = [], existingTimers = {}, existingPaused = {}, existingMeta = {}) => {
    const hasSavedTimerState = Boolean(
      (existingTimers && Object.keys(existingTimers).length)
      || (existingPaused && Object.keys(existingPaused).length)
      || (existingMeta && Object.keys(existingMeta).length)
    );

    if (hasSavedTimerState || !Array.isArray(rawActivities) || rawActivities.length === 0) {
      return null;
    }

    const reconstructedTimers = {};
    const reconstructedMeta = {};
    const latestOpenByType = {};

    rawActivities.forEach((activity) => {
      if (!activity?.startTime || activity?.endTime) return;
      const existing = latestOpenByType[activity.type];
      if (!existing || new Date(activity.startTime).getTime() > new Date(existing.startTime).getTime()) {
        latestOpenByType[activity.type] = activity;
      }
    });

    ['sleep', 'walk', 'activity'].forEach((type) => {
      const openActivity = latestOpenByType[type];
      if (!openActivity) return;

      const parsedStart = new Date(openActivity.startTime).getTime();
      if (!Number.isFinite(parsedStart)) return;

      reconstructedTimers[type] = parsedStart;
      reconstructedMeta[`${type}StartTime`] = openActivity.startTime;
      reconstructedMeta[`${type}ActivityId`] = openActivity.id;
    });

    const openBreastfeeding = latestOpenByType.breastfeeding;
    if (openBreastfeeding?.startTime) {
      const parsedStart = new Date(openBreastfeeding.startTime).getTime();
      if (Number.isFinite(parsedStart)) {
        const side = String(openBreastfeeding.comment || '').includes('side:right') ? 'right' : 'left';
        reconstructedTimers[side] = parsedStart;
        reconstructedMeta.breastfeedingStartTime = openBreastfeeding.startTime;
        reconstructedMeta.breastfeedingActivityId = openBreastfeeding.id;
      }
    }

    if (!Object.keys(reconstructedTimers).length && !Object.keys(reconstructedMeta).length) {
      return null;
    }

    return {
      timers: reconstructedTimers,
      meta: reconstructedMeta,
    };
  }, []);

  const applyReconstructedTimers = useCallback((restored) => {
    if (!restored) return;
    if (Object.keys(restored.timers || {}).length > 0) {
      setTimers(restored.timers);
    }
    if (Object.keys(restored.meta || {}).length > 0) {
      setTimerMeta(restored.meta);
    }
  }, []);

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

    const restored = reconstructTimersFromActivities(savedActivities, savedTimers, savedPaused, savedTimerMeta);
    applyReconstructedTimers(restored);
    
    // ⬇️ ДОБАВИТЬ ПРОВЕРКУ
    if (savedProfile) {
      // Если в кеше нет id - НЕ используем кеш, загрузим из БД
      if (savedProfile.id) {
        setBabyProfile(savedProfile);
      } else {
        console.warn('⚠️ Cached profile missing id, will load from DB');
      }
    }
    
    if (savedGrowth) setGrowthData(savedGrowth);
  }, [applyReconstructedTimers, reconstructTimersFromActivities]);

  const preloadNotifications = useCallback(async () => {
    try {
      // Сначала пытаемся загрузить из кеша (быстро)
      const cached = await cacheService.get('notifications');
      if (cached) {
        setNotifications(cached);
        console.log('📬 Notifications loaded from cache');
      }

      // Затем загружаем из сети (если есть helpers)
      if (notificationHelpers) {
        const { data, error } = await notificationHelpers.getNotifications();
        if (data && !error) {
          setNotifications(data);
          await cacheService.set('notifications', data, CACHE_TTL_SECONDS);
          console.log('📬 Notifications loaded from network and cached');
        }
      }
    } catch (error) {
      console.error('Preload notifications error:', error);
      // Не критично - просто не предзагружаем
    }
  }, [notificationHelpers]);

  const hasBabyProfile = useMemo(() => {
    return Boolean(babyProfile.name?.trim() && babyProfile.birthDate);
  }, [babyProfile]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setIsInitializing(true); // 🔧 ИСПРАВЛЕНИЕ: Блокируем автосохранение на время загрузки
    setAuthError(null);
    setIsOnboardingStatusResolved(false);
    
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
        setCurrentUser(null);
        const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
        
        // КРИТИЧЕСКИ ВАЖНО: Проверяем смену пользователя ДО установки namespace
        const potentialNamespace = buildUserNamespace(null, telegramUser);
        const previousNamespace = activeNamespaceRef.current;
        const userChanged = previousNamespace !== 'global' && previousNamespace !== potentialNamespace;
        
        if (userChanged) {
          console.log('🔄 Обнаружена смена пользователя Telegram!');
          console.log('   Предыдущий namespace:', previousNamespace);
          console.log('   Новый namespace:', potentialNamespace);
          
          // Очищаем старый кеш ПЕРЕД установкой нового namespace
          await cacheService.clear();
          console.log('🗑️ Кеш предыдущего пользователя очищен');
        }
        
        // Устанавливаем namespace для текущего пользователя
        cacheService.setNamespace(potentialNamespace);

        try {
          const { user, error, mode } = await supabaseModule.authHelpers.ensureAuthenticatedSession({
            telegramUser,
            platform: Platform.getCurrentPlatform(),
          });

          // НОВАЯ ЛОГИКА: Проверка на необходимость авторизации
          if (mode === 'needs_registration') {
            console.log('⚠️ Требуется регистрация');
            console.log('🔍 DEBUG: needsAuth =', true, ', authMode = register, isLoading =', false);
            setTelegramUserRef(telegramUser);
            setCurrentUser(null);
            setNeedsAuth(true);
            setAuthMode('register');
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
          }

          if (mode === 'needs_login' || mode === 'needs_auth') {
            console.log('⚠️ Требуется вход');
            console.log('🔍 DEBUG: needsAuth = true, authMode = login, isLoading = false');
            setTelegramUserRef(telegramUser);
            setCurrentUser(null);
            setNeedsAuth(true);
            setAuthMode('login');
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
          }

          if (error) {
            console.error('Auth error:', error);
            setAuthError('Ошибка аутентификации - используется кеш');
            await loadFromCache();
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
          }

          setIsAuthenticated(Boolean(user));
          setCurrentUser(user || null);
          const nextNamespace = buildUserNamespace(user, telegramUser);
          
          // Обновляем namespace с учетом авторизованного пользователя
          if (nextNamespace !== potentialNamespace) {
            console.log('📝 Обновление namespace после авторизации:', nextNamespace);
            cacheService.setNamespace(nextNamespace);
          }

          // Загружаем notification helpers заранее для предзагрузки
          if (!notificationHelpers) {
            try {
              const notifModule = await import('./utils/notifications.js');
              setNotificationHelpers(() => notifModule.notificationHelpers);
            } catch (error) {
              console.error('Failed to load notification helpers:', error);
            }
          }

          // Обновляем ссылку на текущий namespace
          if (previousNamespace !== nextNamespace) {
            activeNamespaceRef.current = nextNamespace;
            
            // Очищаем состояние приложения при смене пользователя
            setActivities([]);
            setTimers({});
            setPausedTimers({});
            setTimerMeta({});
            setGrowthData([]);
            setBabyProfile({ name: '', birthDate: '', photo: null });
            setView('main');
            setSelectedActivity(null);
            setFormData({});
            setEditingId(null);
          }

          const onboardingFlag = await cacheService.get(ONBOARDING_COMPLETED_KEY);
          setIsOnboardingCompleted(Boolean(onboardingFlag));

          // Настройки загружаем централизованно и отдельно от остальных данных,
          // чтобы экран настроек был расширяемым и не зависел от структуры конкретных фич.
          const loadedUserSettings = await userSettingsService.load();
          setUserSettings(loadedUserSettings);

          if (mode === 'anonymous') {
            console.log('Signed in with anonymous Supabase session');
          }

          let initialData = null;
          try {
            // Получаем baby_id для фильтрации
            const currentUser = await supabaseModule.authHelpers.getCurrentUser();
            const { data: babyData } = await supabaseModule.supabase
              .from('babies')
              .select('id')
              .eq('user_id', currentUser.id)
              .single();
            
            const babyId = babyData?.id;

            if (babyId) {
              // Загружаем данные с кешированием
              const [profileResult, activitiesResult, growthResult, openTimersResult] = await Promise.all([
                supabaseService.getWithCache('babies', { 
                  eq: { user_id: currentUser.id } 
                }, 3600), // TTL 1 час для профиля
                
                supabaseService.getWithCache('activities', { 
                  eq: { baby_id: babyId },
                  order: { column: 'start_time', ascending: false },
                  limit: 100 // Ограничиваем последними 100 активностями
                }, 1800), // TTL 30 минут для активностей
                
                supabaseService.getWithCache('growth_records', { 
                  eq: { baby_id: babyId },
                  order: { column: 'measurement_date', ascending: false }
                }, 3600), // TTL 1 час для роста

                // Важно: отдельно получаем все открытые таймеры без лимита,
                // чтобы длинные активности не терялись из-за limit:100.
                supabaseModule.supabase
                  .from('activities')
                  .select('*')
                  .eq('baby_id', babyId)
                  .is('end_time', null)
                  .in('type', ['breastfeeding', 'sleep', 'walk', 'activity'])
                  .order('start_time', { ascending: false })
              ]);

              const mergedActivities = [
                ...(activitiesResult.data || []),
                ...(openTimersResult.data || []),
              ];

              const dedupedActivities = Array.from(
                new Map(mergedActivities.map((row) => [row.id, row])).values()
              );

              initialData = {
                profile: { data: profileResult.data?.[0] || null },
                activities: { data: dedupedActivities },
                growth: { data: growthResult.data || [] }
              };
            } else {
              // Fallback если baby не найден
              initialData = supabaseModule.appDataHelpers
                ? await supabaseModule.appDataHelpers.getInitialData()
                : {
                    profile: await supabaseModule.babyHelpers.getProfile(),
                    activities: await supabaseModule.activityHelpers.getActivities(),
                    growth: await supabaseModule.growthHelpers.getRecords(),
                  };
            }

            if (initialData.profile?.data) {
              const profile = {
                id: initialData.profile.data.id, // ⬅️ ДОБАВЛЕНО
                name: initialData.profile.data.name || '',
                birthDate: initialData.profile.data.birth_date || '',
                photo: initialData.profile.data.photo_url || null,
              };
              setBabyProfile({
                id: profile.id, // ⬅️ ДОБАВЛЕНО
                name: profile.name,
                birthDate: profile.birthDate,
                photo: profile.photo,
              });

              await Promise.all([
                cacheService.set('baby_profile', profile, null),
                cacheService.set(ONBOARDING_COMPLETED_KEY, true, null),
              ]);
              setIsOnboardingCompleted(true);
            }

            if (initialData.activities?.data) {
              const normalizedActivities = initialData.activities.data.map(convertFromSupabaseActivity);
              setActivities(normalizedActivities);

              const [savedTimers, savedPaused, savedTimerMeta] = await Promise.all([
                cacheService.get('active_timers'),
                cacheService.get('paused_timers'),
                cacheService.get('timer_meta')
              ]);

              const restored = reconstructTimersFromActivities(normalizedActivities, savedTimers, savedPaused, savedTimerMeta);
              applyReconstructedTimers(restored);
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

          // 🔧 ИСПРАВЛЕНИЕ: Снимаем флаг ПОСЛЕ загрузки таймеров
          setIsInitializing(false);

          await notificationService.initialize();

          if (!initialData?.profile?.data) {
            // Кейс: локальный кэш очищен (переустановка Telegram/WebView),
            // но профиль уже существует в Supabase. Проверяем ещё раз напрямую,
            // чтобы не показать онбординг повторно существующему пользователю.
            try {
              const profileResult = await supabaseModule.babyHelpers.getProfile();
              if (profileResult?.data) {
                const fallbackProfile = {
                  id: profileResult.data.id, // ⬅️ ДОБАВЛЕНО
                  name: profileResult.data.name || '',
                  birthDate: profileResult.data.birth_date || '',
                  photo: profileResult.data.photo_url || null,
                };

                setBabyProfile(fallbackProfile);
                await Promise.all([
                  cacheService.set('baby_profile', fallbackProfile, null),
                  cacheService.set(ONBOARDING_COMPLETED_KEY, true, null),
                ]);
                setIsOnboardingCompleted(true);
              }
            } catch (profileError) {
              console.error('Fallback profile check error:', profileError);
            }
          }

          setIsOnboardingStatusResolved(true);
          
          // Фоновая загрузка уведомлений (не блокирует UI)
          void preloadNotifications();
          
        } catch (supabaseError) {
          console.error('Supabase error:', supabaseError);
          setAuthError('Supabase недоступен - используется кеш');
          await loadFromCache();
          setIsOnboardingStatusResolved(true);
        }
      } else {
        // Not in Telegram or Supabase not configured, use cache
        const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
        const nextNamespace = buildUserNamespace(null, telegramUser);
        cacheService.setNamespace(nextNamespace);
        activeNamespaceRef.current = nextNamespace;
        const onboardingFlag = await cacheService.get(ONBOARDING_COMPLETED_KEY);
        setIsOnboardingCompleted(Boolean(onboardingFlag));
        const loadedUserSettings = await userSettingsService.load();
        setUserSettings(loadedUserSettings);
        console.log('Using cache fallback (no Telegram or Supabase config)');
        await loadFromCache();
        setIsOnboardingStatusResolved(true);
      }
    } catch (error) {
      console.error('Load data error:', error);
      setAuthError('Ошибка загрузки данных');
      await loadFromCache();
      setIsOnboardingStatusResolved(true);
    } finally {
      clearTimeout(loadTimeout);
      setIsLoading(false);
      setIsInitializing(false);
    }
  }, [loadFromCache, applyReconstructedTimers, preloadNotifications, reconstructTimersFromActivities]);

  const ensureDraftActivityForTimer = useCallback(async (activityType, startTimestampMs, side = null) => {
    if (!isAuthenticated || !hasBabyProfile) return;

    const idKey = activityType === 'breastfeeding'
      ? 'breastfeedingActivityId'
      : `${activityType}ActivityId`;

    if (timerMetaRef.current?.[idKey]) return;

    const startIso = new Date(startTimestampMs).toISOString();
    const draftPayload = {
      type: activityType,
      startTime: startIso,
      endTime: null,
      comment: activityType === 'breastfeeding'
        ? `side:${side || 'left'}`
        : 'started_from:app_timer',
      leftDuration: activityType === 'breastfeeding' ? 0 : undefined,
      rightDuration: activityType === 'breastfeeding' ? 0 : undefined,
    };

    try {
      const { data, error } = await supabaseModule.activityHelpers.createActivity(draftPayload);
      if (error) {
        console.warn('Failed to create timer draft activity:', error);
        return;
      }

      if (data?.id) {
        setTimerMeta(prev => ({ ...prev, [idKey]: data.id }));
      }
    } catch (error) {
      console.warn('Failed to persist running timer draft:', error);
    }
  }, [isAuthenticated, hasBabyProfile]);

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
    return activitiesByChronology.filter((activity) => Boolean(activity.startTime || activity.endTime));
  }, [activitiesByChronology]);

  const filteredHistoryActivities = useMemo(() => {
    const startDate = historyFilterStartDate ? new Date(`${historyFilterStartDate}T00:00:00`) : null;
    const endDate = historyFilterEndDate ? new Date(`${historyFilterEndDate}T23:59:59`) : null;

    return recentCompletedActivities.filter((activity) => {
      if (!activity.startTime) return false;

      if (historyFilterTypes.length > 0 && !historyFilterTypes.includes(activity.type)) {
        return false;
      }

      const activityDate = new Date(activity.startTime);
      if (Number.isNaN(activityDate.getTime())) return false;

      if (startDate && activityDate < startDate) {
        return false;
      }

      if (endDate && activityDate > endDate) {
        return false;
      }

      return true;
    });
  }, [recentCompletedActivities, historyFilterTypes, historyFilterStartDate, historyFilterEndDate]);

  const historyDayGroups = useMemo(() => {
    const groups = new Map();

    filteredHistoryActivities.forEach((activity) => {
      if (!activity.startTime) return;
      const date = new Date(activity.startTime);
      if (Number.isNaN(date.getTime())) return;

      const dateKey = date.toISOString().slice(0, 10);
      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          dateKey,
          date,
          activities: [],
        });
      }

      groups.get(dateKey).activities.push(activity);
    });

    return Array.from(groups.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((group) => ({
        ...group,
        activities: [...group.activities].sort((a, b) => getActivityChronologyTime(b) - getActivityChronologyTime(a)),
      }));
  }, [filteredHistoryActivities, getActivityChronologyTime]);

  const visibleHistoryDayGroups = useMemo(() => {
    return historyDayGroups.slice(0, historyVisibleDayCount);
  }, [historyDayGroups, historyVisibleDayCount]);

  const getWeekStart = useCallback((offset = 0) => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff + (offset * 7));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }, []);

  const normalizeMonday = useCallback((dateLike) => {
    const date = new Date(dateLike);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);

  const loadMoreHistoryDays = useCallback(() => {
    setHistoryVisibleDayCount((prev) => {
      if (prev >= historyDayGroups.length) return prev;
      return Math.min(prev + 7, historyDayGroups.length);
    });
  }, [historyDayGroups.length]);

  useEffect(() => {
    setHistoryVisibleDayCount(7);
  }, [activities.length, historyFilterTypes, historyFilterStartDate, historyFilterEndDate]);

  useEffect(() => {
    if (view !== 'history' || historyTab !== 'list') return;
    const target = historyLoadTriggerRef.current;
    if (!target || historyVisibleDayCount >= historyDayGroups.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreHistoryDays();
        }
      },
      { root: null, rootMargin: '180px 0px' }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [view, historyTab, historyVisibleDayCount, historyDayGroups.length, loadMoreHistoryDays]);

  const handleBack = useCallback(() => {
    if (view === 'history-filters') {
      if (tg) tg.HapticFeedback?.impactOccurred('light');
      setView('history');
      return;
    }

    if (view !== 'main') {
      if (tg) tg.HapticFeedback?.impactOccurred('light');
      setView('main');
      setSelectedActivity(null);
      setFormData({});
      setEditingId(null);
    }
  }, [view, tg]);

  const navigateTo = useCallback((nextView) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    setView(nextView);

    if (nextView !== 'add') {
      setSelectedActivity(null);
      setFormData({});
      setEditingId(null);
    }
  }, [tg]);

  const renderBottomNavigation = () => (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-purple-100 bg-white/95 backdrop-blur-sm">
      <div className="max-w-2xl mx-auto px-4 py-2">
        <div className="grid grid-cols-5 gap-2">
          <button
            onClick={() => navigateTo('main')}
            className={`flex flex-col items-center justify-center rounded-xl py-2 text-xs font-medium transition-colors ${
              view === 'main' ? 'bg-purple-100 text-purple-700' : 'text-gray-500'
            }`}
          >
            <Home className="w-5 h-5 mb-1" />
            Главная
          </button>
          <button
            onClick={() => navigateTo('history')}
            className={`flex flex-col items-center justify-center rounded-xl py-2 text-xs font-medium transition-colors ${
              view === 'history' ? 'bg-purple-100 text-purple-700' : 'text-gray-500'
            }`}
          >
            <History className="w-5 h-5 mb-1" />
            История
          </button>
          <button
            onClick={() => navigateTo('stats')}
            className={`flex flex-col items-center justify-center rounded-xl py-2 text-xs font-medium transition-colors ${
              view === 'stats' || view === 'stats-activity-detail' ? 'bg-purple-100 text-purple-700' : 'text-gray-500'
            }`}
          >
            <BarChart3 className="w-5 h-5 mb-1" />
            Статистика
          </button>
          <button
            onClick={() => navigateTo('notifications')}
            className={`flex flex-col items-center justify-center rounded-xl py-2 text-xs font-medium transition-colors ${
              view === 'notifications' ? 'bg-purple-100 text-purple-700' : 'text-gray-500'
            }`}
          >
            <Bell className="w-5 h-5 mb-1" />
            Уведомления
          </button>
          <button
            onClick={() => navigateTo('settings')}
            className={`flex flex-col items-center justify-center rounded-xl py-2 text-xs font-medium transition-colors ${
              view === 'settings' ? 'bg-purple-100 text-purple-700' : 'text-gray-500'
            }`}
          >
            <SettingsIcon className="w-5 h-5 mb-1" />
            Настройки
          </button>
        </div>
      </div>
    </div>
  );

  const renderActivityDetails = (activity, textClass = 'text-sm opacity-75') => {
    if (activity.type === 'breastfeeding') {
      return <div className={textClass}>Л: {Math.floor(activity.leftDuration / 60)}м, П: {Math.floor(activity.rightDuration / 60)}м</div>;
    }

    if (activity.type === 'burp') {
      return (
        <>
          {activity.burpColor && <div className={textClass}>Цвет: {activity.burpColor}</div>}
          {activity.burpConsistency && <div className={textClass}>Консистенция: {activity.burpConsistency}</div>}
          {activity.burpVolume && <div className={textClass}>Объём: {activity.burpVolume === 'less_than_teaspoon' ? 'меньше чайной ложки' : 'больше чайной ложки'}</div>}
        </>
      );
    }

    return (
      <>
        {activity.foodType && (
          <div className={textClass}>{activity.foodType === 'breast_milk' ? 'Грудное молоко' : activity.foodType === 'formula' ? 'Смесь' : 'Вода'}</div>
        )}
        {activity.amount && <div className={textClass}>Количество: {activity.amount} мл</div>}
        {activity.diaperType && <div className={textClass}>{activity.diaperType === 'wet' ? 'Мокрый' : 'Грязный'}</div>}
        {activity.medicineName && <div className={textClass}>{activity.medicineName}</div>}
      </>
    );
  };

  const renderRecentActivityCard = (activity) => {
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
              {renderActivityDetails(activity)}
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
  };

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
        delete updatedMeta.breastfeedingActivityId;
        return updatedMeta;
      });
    }

    if (timerType === 'sleep' || timerType === 'walk' || timerType === 'activity') {
      setTimerMeta(prev => {
        const metaKey = `${timerType}StartTime`;
        if (!prev[metaKey]) return prev;
        const updatedMeta = { ...prev };
        delete updatedMeta[metaKey];
        delete updatedMeta[`${timerType}ActivityId`];
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

    if ((formData.type === 'sleep' || formData.type === 'walk' || formData.type === 'activity' || formData.type === 'custom')
      && formData.type === 'custom') {
      const manualDurationMinutes = Number(formData.manualDurationMinutes);
      if (!Number.isFinite(manualDurationMinutes) || manualDurationMinutes <= 0) {
        if (tg) tg.HapticFeedback?.notificationOccurred('error');
        alert('Укажите длительность активности в минутах');
        setIsSaving(false);
        return;
      }
    }

    if (formData.type === 'sleep' || formData.type === 'walk' || formData.type === 'activity') {
      const durationFromRange = getDurationSecondsFromTimeRange(formData.startTime, formData.endTime, !formData.endTime);
      const durationSeconds = durationFromRange || getTotalDuration(formData.type) || parseDurationInputToSeconds(formData.elapsedDuration);
      if (durationSeconds <= 0) {
        if (tg) tg.HapticFeedback?.notificationOccurred('error');
        alert('Укажите длительность в формате ЧЧ:ММ:СС');
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

    if (formData.type === 'custom' && !String(formData.medicineName || '').trim()) {
      if (tg) tg.HapticFeedback?.notificationOccurred('error');
      alert('Для "Своего события" укажите название');
      setIsSaving(false);
      return;
    }
    
    const activityData = {
      id: editingId || Date.now(),
      ...formData,
      date: new Date(formData.startTime).toLocaleDateString('ru-RU'),
    };

    if (formData.type === 'breastfeeding') {
      const leftDuration = getTotalDuration('left') || parseDurationInputToSeconds(formData.leftElapsedDuration);
      const rightDuration = getTotalDuration('right') || parseDurationInputToSeconds(formData.rightElapsedDuration);
      const totalDuration = leftDuration + rightDuration;
      const breastfeedingStartTime = editingId ? formData.startTime : (timerMeta.breastfeedingStartTime || formData.startTime);

      activityData.leftDuration = leftDuration;
      activityData.rightDuration = rightDuration;
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
      const hasTimerData = Boolean(timers[timerKey] || pausedTimers[timerKey]);
      const durationFromRange = getDurationSecondsFromTimeRange(formData.startTime, formData.endTime, !formData.endTime);
      const duration = durationFromRange || getTotalDuration(timerKey) || parseDurationInputToSeconds(formData.elapsedDuration);
      const timerStartTime = formData.startTime || (hasTimerData ? (timerMeta[`${timerKey}StartTime`] || formData.startTime) : formData.startTime);
      const resolvedEndTime = formData.endTime || new Date(new Date(timerStartTime).getTime() + duration * 1000).toISOString();

      activityData.startTime = timerStartTime;
      activityData.endTime = resolvedEndTime;
      activityData.elapsedDuration = formatSeconds(getDurationSecondsFromTimeRange(timerStartTime, resolvedEndTime, false));

      if (!editingId && hasTimerData) {
        resetTimer(timerKey);
      }
    } else if (formData.type === 'custom') {
      activityData.medicineName = String(formData.medicineName || '').trim();
      const manualDurationMinutes = Math.max(0, Number(formData.manualDurationMinutes) || 0);
      activityData.endTime = new Date(new Date(activityData.startTime).getTime() + manualDurationMinutes * 60 * 1000).toISOString();
    } else if (formData.type === 'burp') {
      activityData.endTime = activityData.startTime;
      activityData.foodType = null;
      activityData.diaperType = null;
      activityData.medicineName = null;
    } else if (['bath', 'diaper', 'medicine', 'bottle'].includes(formData.type) && !activityData.endTime) {
      activityData.endTime = activityData.startTime;
    } else if (!activityData.endTime) {
      activityData.endTime = new Date().toISOString();
    }

    try {
      if (isAuthenticated) {
        // Save to Supabase
        const supabaseData = convertToSupabaseActivity(activityData);
        const draftActivityId = !editingId
          ? (formData.type === 'breastfeeding'
            ? timerMeta.breastfeedingActivityId
            : timerMeta[`${formData.type}ActivityId`])
          : null;
        const updateTargetId = editingId || draftActivityId;
        
        if (updateTargetId) {
          const { data, error } = await supabaseModule.activityHelpers.updateActivity(updateTargetId, supabaseData);
          if (error) throw error;
          
          const updatedActivity = convertFromSupabaseActivity(data);
          // 🔧 ИСПРАВЛЕНИЕ: Обновляем state и инвалидируем кеш
          setActivities(prev => {
            const hasExisting = prev.some(a => a.id === updateTargetId);
            const updatedActivities = hasExisting
              ? prev.map(a => a.id === updateTargetId ? updatedActivity : a)
              : [updatedActivity, ...prev];
            // Инвалидируем кеш supabaseService
            supabaseService.invalidateTableCache('activities').catch(console.error);
            return updatedActivities;
          });
        } else {
          const { data, error } = await supabaseModule.activityHelpers.createActivity(supabaseData);
          if (error) throw error;
          
          const newActivity = convertFromSupabaseActivity(data);
          // 🔧 ИСПРАВЛЕНИЕ: Обновляем state и инвалидируем кеш
          setActivities(prev => {
            const updatedActivities = [newActivity, ...prev];
            // Инвалидируем кеш supabaseService для таблицы activities
            supabaseService.invalidateTableCache('activities').catch(console.error);
            return updatedActivities;
          });
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
        }
        
        // 🔧 ИСПРАВЛЕНИЕ: Обновляем state и инвалидируем кеш
        setActivities(prev => {
          const updatedActivities = prev.filter(a => a.id !== id);
          // Инвалидируем кеш supabaseService
          supabaseService.invalidateTableCache('activities').catch(console.error);
          return updatedActivities;
        });
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
    const isDurationBasedActivity = ['sleep', 'walk', 'activity', 'custom'].includes(activity.type);
    const durationSeconds = getDurationSecondsFromTimeRange(activity.startTime, activity.endTime, false);
    const durationMinutes = durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : '';

    setFormData(
      isDurationBasedActivity
        ? {
          ...activity,
          elapsedDuration: formatSeconds(durationSeconds),
          manualDurationMinutes: durationMinutes,
        }
        : {
          ...activity,
          leftElapsedDuration: formatSeconds(activity.leftDuration || 0),
          rightElapsedDuration: formatSeconds(activity.rightDuration || 0),
        }
    );
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

  const saveTimersImmediately = useCallback((timersData, pausedData, metaData) => {
    Promise.all([
      cacheService.set('active_timers', timersData, null),
      cacheService.set('paused_timers', pausedData, null),
      cacheService.set('timer_meta', metaData, null),
    ]).catch(error => {
      console.error('Failed to persist timers:', error);
    });
  }, []);

  // Throttled cache save для таймеров - сохраняем раз в 10 секунд вместо каждую секунду
  const saveTimersToCache = useMemo(
    () => debounce((timersData, pausedData, metaData) => {
      saveTimersImmediately(timersData, pausedData, metaData);
    }, 10000),
    [saveTimersImmediately]
  );

  useEffect(() => {
    timersRef.current = timers;
    pausedTimersRef.current = pausedTimers;
    timerMetaRef.current = timerMeta;

    // 🔧 ИСПРАВЛЕНИЕ: Не сохраняем во время инициализации, чтобы избежать race condition
    if (!isLoading && !isInitializing) {
      // Throttled save - раз в 10 секунд вместо каждую секунду
      saveTimersToCache(timers, pausedTimers, timerMeta);
    }
  }, [timers, pausedTimers, timerMeta, isLoading, isInitializing, saveTimersToCache]);

  // Сохраняем при закрытии/рефреше страницы и размонтировании компонента (важно!)
  useEffect(() => {
    const persistTimersSnapshot = () => {
      saveTimersImmediately(timersRef.current, pausedTimersRef.current, timerMetaRef.current);
    };

    const handlePageHide = () => {
      saveTimersToCache.cancel?.();
      persistTimersSnapshot();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      handlePageHide();
    };
  }, [saveTimersImmediately, saveTimersToCache]);

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

  // Применяем язык приложения сразу после изменения настройки.
  useEffect(() => {
    const language = userSettings?.language || 'ru';
    document.documentElement.lang = language;
  }, [userSettings?.language]);

  // Применяем тему на уровне документа, чтобы смена работала мгновенно.
  useEffect(() => {
    const isDark = userSettings?.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark-theme', isDark);
  }, [userSettings?.theme]);

  // Sync profileForm with babyProfile when entering profile view
  useEffect(() => {
    if (view === 'profile' || view === 'onboarding') {
      setProfileForm(babyProfile);
    }
  }, [view, babyProfile]);

  useEffect(() => {
    if (!isLoading && isOnboardingStatusResolved && !isOnboardingCompleted && !hasBabyProfile && view === 'main') {
      setProfileForm(prev => ({
        ...prev,
        name: babyProfile.name || '',
        birthDate: babyProfile.birthDate || '',
        photo: babyProfile.photo || null,
      }));
      setView('onboarding');
    }
  }, [isLoading, isOnboardingStatusResolved, isOnboardingCompleted, hasBabyProfile, view, babyProfile]);

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
      setFormData({ ...baseData, leftDuration: 0, rightDuration: 0, leftElapsedDuration: '00:00:00', rightElapsedDuration: '00:00:00' });
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
    } else if (type === 'custom') {
      setFormData({ ...baseData, medicineName: '', comment: '', manualDurationMinutes: '10', timeInputMode: 'manual' });
    } else {
      setFormData(
        (type === 'sleep' || type === 'walk' || type === 'activity')
          ? { ...baseData, elapsedDuration: '00:00:00', endTime: '' }
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
        leftElapsedDuration: formatSeconds(getTotalDuration('left')),
        rightElapsedDuration: formatSeconds(getTotalDuration('right')),
      });
    } else {
      setFormData({ 
        type, 
        startTime,
        comment: '',
        elapsedDuration: formatSeconds(getTotalDuration(type)),
        endTime: '',
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
          id: data.id, // ⬅️ ДОБАВЛЕНО
          name: data.name || '',
          birthDate: data.birth_date || '',
          photo: data.photo_url || null,
        });
        await Promise.all([
          cacheService.set('baby_profile', {
            id: data.id, // ⬅️ ДОБАВЛЕНО
            name: data.name || '',
            birthDate: data.birth_date || '',
            photo: data.photo_url || null,
          }, null),
          cacheService.set(ONBOARDING_COMPLETED_KEY, true, null),
        ]);
      } else {
        const trimmedProfile = {
          ...profileForm,
          name: profileForm.name.trim(),
        };
        setBabyProfile(trimmedProfile);
        await Promise.all([
          cacheService.set('baby_profile', trimmedProfile, null),
          cacheService.set(ONBOARDING_COMPLETED_KEY, true, null),
        ]);
      }
      setIsOnboardingCompleted(true);
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
      setGrowthForm({ date: getTodayDateString(), weight: '', height: '' });
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
          setGrowthForm({ date: getTodayDateString(), weight: '', height: '' });
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
        breastfeedingStartTime: prev.breastfeedingStartTime || new Date(now - (Number.isFinite(ownPausedDuration) ? ownPausedDuration : 0)).toISOString()
      }));

      const draftStart = now - (Number.isFinite(ownPausedDuration) ? ownPausedDuration : 0);
      void ensureDraftActivityForTimer('breastfeeding', draftStart, timerType);

      return;
    }

    const pausedDuration = Number(pausedTimers[key]);
    setTimers(prev => ({ ...prev, [key]: now - (Number.isFinite(pausedDuration) ? pausedDuration : 0) }));
    setTimerMeta(prev => ({
      ...prev,
      [`${key}StartTime`]: prev[`${key}StartTime`] || new Date(now - (Number.isFinite(pausedDuration) ? pausedDuration : 0)).toISOString()
    }));

    const draftStart = now - (Number.isFinite(pausedDuration) ? pausedDuration : 0);
    if (['sleep', 'walk', 'activity'].includes(key)) {
      void ensureDraftActivityForTimer(key, draftStart);
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

  const handleElapsedDurationChange = (timerKey, field, value) => {
    const seconds = parseDurationInputToSeconds(value);

    setTimers(prev => {
      const next = { ...prev };
      delete next[timerKey];
      return next;
    });

    setPausedTimers(prev => {
      const next = { ...prev };
      if (seconds > 0) {
        next[timerKey] = seconds * 1000;
      } else {
        delete next[timerKey];
      }
      return next;
    });

    setTimerMeta(prev => {
      const metaKey = timerKey === 'left' || timerKey === 'right' ? 'breastfeedingStartTime' : `${timerKey}StartTime`;
      const next = { ...prev };
      if (seconds > 0) {
        next[metaKey] = new Date(Date.now() - seconds * 1000).toISOString();
      } else {
        delete next[metaKey];
      }
      return next;
    });

    setFormData(prev => ({
      ...prev,
      [field]: value,
      ...(isTimerActivity(timerKey)
        ? { endTime: new Date(new Date(prev.startTime || new Date().toISOString()).getTime() + seconds * 1000).toISOString() }
        : {}),
    }));
  };

  const handleTimerDateChange = (timerKey, field, localValue) => {
    const isoValue = fromLocalDateTimeString(localValue);

    setFormData(prev => {
      const nextStart = field === 'startTime' ? isoValue : prev.startTime;
      let nextEnd = field === 'endTime' ? isoValue : prev.endTime;

      if (nextStart && nextEnd && new Date(nextEnd).getTime() < new Date(nextStart).getTime()) {
        nextEnd = nextStart;
      }

      const nextDurationSeconds = getDurationSecondsFromTimeRange(nextStart, nextEnd, true);

      if (!editingId) {
        setTimers(currentTimers => {
          const updated = { ...currentTimers };
          delete updated[timerKey];
          return updated;
        });

        setPausedTimers(currentPaused => {
          const updated = { ...currentPaused };
          if (nextDurationSeconds > 0) {
            updated[timerKey] = nextDurationSeconds * 1000;
          } else {
            delete updated[timerKey];
          }
          return updated;
        });

        setTimerMeta(currentMeta => ({
          ...currentMeta,
          ...(nextStart ? { [`${timerKey}StartTime`]: nextStart } : {}),
        }));
      }

      return {
        ...prev,
        [field]: isoValue,
        ...(field === 'startTime' ? { startTime: nextStart } : {}),
        endTime: nextEnd || '',
        elapsedDuration: formatSeconds(nextDurationSeconds),
      };
    });
  };

  // Централизованное обновление настроек пользователя.
  // Такой подход упрощает расширение экрана новыми типами настроек в будущем.
  const updateUserSettings = useCallback(async (updater) => {
    const nextSettings = await userSettingsService.update((current) => {
      const draft = typeof updater === 'function' ? updater(current) : updater;
      return draft;
    });
    setUserSettings(nextSettings);
    return nextSettings;
  }, []);

  const handleLanguageChange = useCallback(async (language) => {
    await updateUserSettings((current) => ({ ...current, language }));
  }, [updateUserSettings]);

  const handleThemeChange = useCallback(async (theme) => {
    await updateUserSettings((current) => ({ ...current, theme }));
  }, [updateUserSettings]);

  const handleSystemNotificationToggle = useCallback(async (notificationId, enabled) => {
    await updateUserSettings((current) => ({
      ...current,
      systemNotifications: {
        ...current.systemNotifications,
        [notificationId]: enabled,
      },
    }));
  }, [updateUserSettings]);

  const handlePasswordChange = useCallback(async ({ currentPassword, newPassword }) => {
    if (!currentUser?.email) {
      return { error: 'Не удалось определить email текущего пользователя.' };
    }

    const { error: reauthError } = await supabaseModule.authHelpers.signInWithEmail(currentUser.email, currentPassword);
    if (reauthError) {
      return {
        error: reauthError.message === 'Invalid login credentials'
          ? 'Текущий пароль указан неверно.'
          : 'Не удалось проверить текущий пароль.',
      };
    }

    const { error: updateError } = await supabaseModule.authHelpers.updatePassword(newPassword);
    if (updateError) {
      return { error: updateError.message || 'Не удалось изменить пароль.' };
    }

    return { error: null };
  }, [currentUser?.email]);

  const handleSupportClick = useCallback(() => {
    const email = 'makartsevakz@gmail.com';
    const subject = `Поддержка пользователя (${currentUser?.email || 'unknown'})`;
    const body = [
      'Здравствуйте!',
      '',
      'Опишите ваш вопрос:',
      '',
      '---',
      `Email: ${currentUser?.email || 'unknown'}`,
      `Версия приложения: ${import.meta.env.VITE_APP_VERSION || 'dev'}`,
      `Платформа: ${Platform.getCurrentPlatform()}`,
      `Язык: ${userSettings.language}`,
      `Тема: ${userSettings.theme}`,
    ].join('\n');

    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [currentUser?.email, userSettings.language, userSettings.theme]);

  const handleLogout = useCallback(async () => {
    if (!window.confirm('Выйти из профиля?')) return;

    await supabaseModule.authHelpers.signOut();
    await cacheService.clear();

    setActivities([]);
    setTimers({});
    setPausedTimers({});
    setTimerMeta({});
    setNotifications([]);
    setGrowthData([]);
    setBabyProfile({ name: '', birthDate: '', photo: null });
    setCurrentUser(null);
    setUserSettings(DEFAULT_USER_SETTINGS);
    setIsAuthenticated(false);
    setNeedsAuth(true);
    setAuthMode('login');
    setView('main');
  }, []);

// ========================================
  // ОБРАБОТЧИКИ АВТОРИЗАЦИИ
  // ========================================

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthFormError('');
    setIsLoading(true);

    try {
      const { data, error } = await supabaseModule.authHelpers.signInWithEmail(
        authEmail, 
        authPassword
      );

      if (error) {
        setAuthFormError(error.message === 'Invalid login credentials' 
          ? 'Неверный email или пароль' 
          : error.message);
        setIsLoading(false);
        return;
      }

      if (data?.user) {
        // Если это Telegram - привязываем аккаунт
        if (telegramUserRef) {
          await supabaseModule.authHelpers.linkTelegramAccount(telegramUserRef);
        }

        // Сбрасываем флаг авторизации и перезагружаем данные
        setNeedsAuth(false);
        setAuthEmail('');
        setAuthPassword('');
        setAuthFullName('');
        await loadData();
      }

      setIsLoading(false);
    } catch (error) {
      console.error('❌ Ошибка входа:', error);
      setAuthFormError('Произошла ошибка. Попробуйте снова.');
      setIsLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthFormError('');
    setIsLoading(true);

    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail.trim())) {
        setAuthFormError('Введите корректный email');
        setIsLoading(false);
        return;
      }

      if (authPassword.length < 6) {
        setAuthFormError('Пароль должен быть не менее 6 символов');
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabaseModule.authHelpers.signUpWithEmail(
        authEmail, 
        authPassword, 
        authFullName
      );

      if (error) {
        setAuthFormError(error.message.includes('already registered') 
          ? 'Этот email уже зарегистрирован' 
          : error.message);
        setIsLoading(false);
        return;
      }

      if (data?.session && data?.user) {
        // Если это Telegram - привязываем аккаунт
        if (telegramUserRef) {
          await supabaseModule.authHelpers.linkTelegramAccount(telegramUserRef);
        }

        // Сбрасываем флаг авторизации и перезагружаем данные
        setNeedsAuth(false);
        setAuthEmail('');
        setAuthPassword('');
        setAuthFullName('');
        await loadData();
      } else if (data?.user) {
        // Если в Supabase включат подтверждение email, то после signUp сессии не будет.
        // В этом случае не входим автоматически и просим пользователя подтвердить почту.
        setAuthFormError('Проверьте почту и подтвердите email, затем выполните вход.');
        setAuthMode('login');
      }

      setIsLoading(false);
    } catch (error) {
      console.error('❌ Ошибка регистрации:', error);
      setAuthFormError('Произошла ошибка. Попробуйте снова.');
      setIsLoading(false);
    }
  };

  // ========================================
  // ЭКРАНЫ АВТОРИЗАЦИИ
  // ========================================

  if (needsAuth && authMode === 'login') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-purple-600 mb-2">👶 Дневник малыша</h1>
            <p className="text-gray-600">Войдите в свой аккаунт</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Пароль
              </label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Введите пароль"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>

            {authFormError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {authFormError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setAuthMode('register')}
              className="text-purple-600 hover:text-purple-700 font-medium"
            >
              Нет аккаунта? Зарегистрироваться
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (needsAuth && authMode === 'register') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-purple-600 mb-2">👶 Дневник малыша</h1>
            <p className="text-gray-600">Создайте аккаунт</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ваше имя (необязательно)
              </label>
              <input
                type="text"
                value={authFullName}
                onChange={(e) => setAuthFullName(e.target.value)}
                placeholder="Введите ваше имя"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
Будет использоваться для входа в приложение и Telegram
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Пароль
              </label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
              />
            </div>

            {authFormError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {authFormError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Регистрация...' : 'Зарегистрироваться'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setAuthMode('login')}
              className="text-purple-600 hover:text-purple-700 font-medium"
            >
              Уже есть аккаунт? Войти
            </button>
          </div>
        </div>
      </div>
    );
  }

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
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        <div className="max-w-2xl mx-auto p-4">
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
                  <div className="grid grid-cols-2 gap-4">
                    {['left', 'right'].map(side => {
                      const fieldKey = side === 'left' ? 'leftElapsedDuration' : 'rightElapsedDuration';
                      return (
                        <div key={side} className="border-2 border-pink-200 rounded-lg p-4">
                          <div className="text-center mb-2 font-medium">{side === 'left' ? 'Левая' : 'Правая'} грудь</div>
                          <input
                            type="text"
                            className="w-full border border-gray-300 rounded-lg p-2 text-center text-lg font-mono mb-3"
                            value={timers[side] ? formatSeconds(getTotalDuration(side)) : (formData[fieldKey] || '00:00:00')}
                            onChange={(e) => handleElapsedDurationChange(side, fieldKey, e.target.value)}
                            placeholder="00:00:00"
                          />
                          <button
                            onClick={() => timers[side] ? pauseTimer(side, 'breastfeeding') : startTimer(side, 'breastfeeding')}
                            className={`w-full py-2 rounded-lg flex items-center justify-center ${timers[side] ? 'bg-red-500 text-white' : 'bg-pink-500 text-white'}`}
                          >
                            {timers[side] ? <><Pause className="w-4 h-4 mr-2" />Стоп</> : <><Play className="w-4 h-4 mr-2" />Старт</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
                    />
                  </div>
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
                  <div className="border-2 border-indigo-200 rounded-lg p-4">
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg p-3 text-center text-2xl font-mono mb-3"
                      value={timers[selectedActivity] ? formatSeconds(getTotalDuration(selectedActivity)) : (formData.elapsedDuration || '00:00:00')}
                      onChange={(e) => handleElapsedDurationChange(selectedActivity, 'elapsedDuration', e.target.value)}
                      placeholder="00:00:00"
                    />
                    {!editingId && (
                      <button onClick={() => timers[selectedActivity] ? pauseTimer(selectedActivity, selectedActivity) : startTimer(selectedActivity, selectedActivity)} className={`w-full py-3 rounded-lg flex items-center justify-center ${timers[selectedActivity] ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'}`}>
                        {timers[selectedActivity] ? <><Pause className="w-5 h-5 mr-2" />Остановить</> : <><Play className="w-5 h-5 mr-2" />Запустить таймер с этой длительности</>}
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => handleTimerDateChange(selectedActivity, 'startTime', e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Время окончания (опционально):</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.endTime)}
                      onChange={(e) => handleTimerDateChange(selectedActivity, 'endTime', e.target.value)}
                    />
                  </div>
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

              {selectedActivity === 'custom' && (
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 font-medium">Название события*:</label>
                    <input
                      type="text"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.medicineName || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, medicineName: e.target.value }))}
                      placeholder="Например: Массаж"
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Время начала*:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value), timeInputMode: 'manual' }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Длительность (минуты):</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.manualDurationMinutes || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, manualDurationMinutes: e.target.value, timeInputMode: 'manual' }))}
                      placeholder="Например, 30"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block mb-2 font-medium">{selectedActivity === 'custom' ? 'Комментарий (опционально):' : 'Комментарий:'}</label>
                <textarea className="w-full border-2 border-gray-200 rounded-lg p-3" rows="3" value={formData.comment || ''} onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))} placeholder={selectedActivity === 'custom' ? 'Дополнительные детали...' : 'Добавьте заметку...'} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {renderBottomNavigation()}
    </>
    );
  }

  if (view === 'onboarding') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        <div className="max-w-2xl mx-auto p-4">
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
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        <div className="max-w-2xl mx-auto p-4">
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
                      setGrowthForm({ date: getTodayDateString(), weight: '', height: '' });
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
      {renderBottomNavigation()}
    </>
    );
  }


  if (view === 'history-filters') {
    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
          <div className="max-w-2xl mx-auto p-4 space-y-4">
            <div className="bg-white rounded-2xl shadow-lg p-4 flex items-center justify-between">
              <button onClick={handleBack} className="p-2 rounded-lg bg-gray-100 text-gray-700" title="Назад">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-xl font-semibold">Фильтры истории</h2>
              <div className="w-9" />
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Дата от</label>
                  <input
                    type="date"
                    value={historyFilterStartDate}
                    onChange={(e) => setHistoryFilterStartDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Дата до</label>
                  <input
                    type="date"
                    value={historyFilterEndDate}
                    onChange={(e) => setHistoryFilterEndDate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Активности</label>
                <div className="space-y-2">
                  {Object.entries(activityTypes).map(([key, type]) => {
                    const checked = historyFilterTypes.includes(key);
                    return (
                      <label key={key} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm">
                        <span>{type.label}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setHistoryFilterTypes((prev) => checked ? prev.filter((item) => item !== key) : [...prev, key])}
                          className="w-4 h-4"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => {
                  setHistoryFilterStartDate('');
                  setHistoryFilterEndDate('');
                  setHistoryFilterTypes([]);
                }}
                className="w-full py-2 rounded-lg border border-gray-300 text-gray-700 font-medium"
              >
                Сбросить фильтры
              </button>
            </div>
          </div>
        </div>
        {renderBottomNavigation()}
      </>
    );
  }


  if (view === 'history') {
    const weekStart = getWeekStart(selectedWeekOffset);
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      return day;
    });

    const indicatorColors = {
      breastfeeding: '#ec4899',
      bottle: '#3b82f6',
      sleep: '#6366f1',
      bath: '#06b6d4',
      walk: '#22c55e',
      activity: '#f97316',
      custom: '#8b5cf6',
      burp: '#84cc16',
      diaper: '#eab308',
      medicine: '#ef4444',
    };

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

      const dominantType = Object.entries(minutesByType).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
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

    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
          <div className="max-w-2xl mx-auto p-4">
            <div className="mb-4 bg-white rounded-2xl shadow-lg p-4">
              <h2 className="text-xl font-semibold">История</h2>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-2 mb-4">
              <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => setHistoryTab('list')}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${historyTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  Список
                </button>
                <button
                  onClick={() => setHistoryTab('table')}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${historyTab === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  Таблица
                </button>
              </div>
            </div>

            {historyTab === 'list' ? (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl shadow-lg p-4">
                  <button
                    onClick={() => setView('history-filters')}
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 flex items-center justify-between text-sm font-medium"
                  >
                    <span>
                      Фильтры
                      {historyFilterTypes.length > 0 && ` · ${historyFilterTypes.length}`}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </button>
                  <div className="mt-2 text-xs text-gray-500">
                    {historyFilterStartDate || historyFilterEndDate || historyFilterTypes.length > 0
                      ? `Диапазон: ${historyFilterStartDate || '...'} — ${historyFilterEndDate || '...'}, типов: ${historyFilterTypes.length || 'все'}`
                      : 'Без фильтров'}
                  </div>
                </div>

                {visibleHistoryDayGroups.map((group, index) => (
                  <div key={group.dateKey} className="space-y-2">
                    {index === Math.max(0, visibleHistoryDayGroups.length - 3) && (
                      <div ref={historyLoadTriggerRef} className="h-px" />
                    )}
                    <div className="text-center text-gray-500 font-medium">
                      {group.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </div>
                    <div className="space-y-3">
                      {group.activities.map((activity) => renderRecentActivityCard(activity))}
                    </div>
                  </div>
                ))}

                {historyDayGroups.length === 0 && (
                  <div className="bg-white rounded-2xl shadow-lg p-8 text-center text-gray-500">По выбранным фильтрам записей нет</div>
                )}
              </div>
            ) : (
              <>
                <div className="bg-white rounded-2xl shadow-lg p-4 mb-4">
                  <div className="flex justify-between items-center mb-4">
                    <button
                      onClick={() => setSelectedWeekOffset(prev => prev - 1)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h3 className="font-semibold text-sm text-center px-2">{formatWeekRange()}</h3>
                    <button
                      onClick={() => setSelectedWeekOffset(prev => prev + 1)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      disabled={selectedWeekOffset >= 0}
                    >
                      <ArrowLeft className="w-5 h-5 rotate-180" style={{ opacity: selectedWeekOffset >= 0 ? 0.3 : 1 }} />
                    </button>
                  </div>
                </div>

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
              </>
            )}
          </div>
        </div>
        {renderBottomNavigation()}
      </>
    );
  }

  if (view === 'stats') {
    const todayDate = getTodayDateString();

    const feedingTodayStats = activities.reduce((acc, activity) => {
      if (!activity.startTime || activity.startTime.slice(0, 10) !== todayDate) return acc;
      if (activity.type === 'breastfeeding') {
        acc.count += 1;
        acc.left += (Number(activity.leftDuration) || 0) / 60;
        acc.right += (Number(activity.rightDuration) || 0) / 60;
      }
      if (activity.type === 'bottle') {
        acc.count += 1;
        acc.bottle += parseInt(activity.amount, 10) || 0;
      }
      return acc;
    }, { count: 0, left: 0, right: 0, bottle: 0 });

    const currentMonday = normalizeMonday(new Date());
    const selectedStatsMonday = normalizeMonday(selectedStatsWeekStart || currentMonday);
    const weekStart = selectedStatsMonday > currentMonday ? currentMonday : selectedStatsMonday;

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
          stats[activity.type] = { count: 0, totalDuration: 0, totalAmount: 0 };
        }
        stats[activity.type].count++;

        if (activity.startTime && activity.endTime) {
          stats[activity.type].totalDuration += new Date(activity.endTime) - new Date(activity.startTime);
        } else if (activity.type === 'breastfeeding') {
          stats[activity.type].totalDuration += (activity.leftDuration + activity.rightDuration) * 1000;
        }

        if (activity.type === 'bottle') {
          stats[activity.type].totalAmount += parseInt(activity.amount, 10) || 0;
        }
      });

      const breastfeeding = stats.breastfeeding || { count: 0, totalDuration: 0, totalAmount: 0 };
      const bottle = stats.bottle || { count: 0, totalDuration: 0, totalAmount: 0 };
      const mergedStats = {
        ...stats,
        feeding: {
          count: breastfeeding.count + bottle.count,
          totalDuration: breastfeeding.totalDuration,
          totalAmount: bottle.totalAmount,
        },
      };

      delete mergedStats.breastfeeding;
      delete mergedStats.bottle;

      return Object.fromEntries(
        Object.entries(mergedStats).map(([type, data]) => [
          type,
          {
            ...data,
            avgCountPerWeek: data.count,
            avgCountPerDay: data.count / 7,
            avgDurationPerDay: data.totalDuration / 7,
            avgDurationPerWeek: data.totalDuration,
            avgAmountPerDay: (data.totalAmount || 0) / 7,
            avgAmountPerWeek: data.totalAmount || 0,
          },
        ])
      );
    };

    const formatAverageCount = (value) => `${Math.round(value)}`;

    const weekStats = getWeekStats();
    const statsActivityTypes = {
      feeding: { icon: Baby, label: 'Кормление', color: 'bg-violet-100 text-violet-700' },
      sleep: activityTypes.sleep,
      bath: activityTypes.bath,
      walk: activityTypes.walk,
      activity: activityTypes.activity,
      custom: activityTypes.custom,
      burp: activityTypes.burp,
      diaper: activityTypes.diaper,
      medicine: activityTypes.medicine,
    };

    const formatAverageCountLabel = (data) => {
      if (data.avgCountPerDay >= 1) {
        return `${formatAverageCount(data.avgCountPerDay)} раз/день`;
      }

      return `${formatAverageCount(data.avgCountPerWeek)} раз/неделю`;
    };



    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
          <div className="max-w-2xl mx-auto p-4">
            <div className="mb-4 bg-white rounded-2xl shadow-lg p-4">
              <h2 className="text-xl font-semibold">Статистика</h2>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-4">
              <h3 className="text-sm font-semibold mb-3 text-gray-700">Разделы по активностям (нажмите для деталей)</h3>
              <div className="space-y-2">
                {Object.entries(statsActivityTypes).map(([type, data]) => {
                  const Icon = data.icon;
                  const stat = weekStats[type];
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        setSelectedStatsActivityType(type);
                        setView('stats-activity-detail');
                      }}
                      className="w-full flex items-center justify-between rounded-xl border border-gray-100 p-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${data.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                          <div className="font-medium text-gray-800">{data.label}</div>
                          {stat ? (
                            <div className="text-xs text-gray-500">
                              {type === 'feeding' ? (
                                <>
                                  Сегодня: {feedingTodayStats.count} кормл.
                                  {' · Л: '}{Math.round(feedingTodayStats.left)} мин
                                  {' · П: '}{Math.round(feedingTodayStats.right)} мин
                                  {' · Бутылочка: '}{Math.round(feedingTodayStats.bottle)} мл
                                </>
                              ) : (
                                <>{formatAverageCountLabel(stat)}</>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">Нет записей за неделю</div>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        {renderBottomNavigation()}
      </>
    );
  }

  if (view === 'stats-activity-detail') {
    const activityMeta = selectedStatsActivityType
      ? (
        selectedStatsActivityType === 'feeding'
          ? { icon: Baby, label: 'Кормление', color: 'bg-violet-100 text-violet-700' }
          : activityTypes[selectedStatsActivityType]
      )
      : null;

    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
          <div className="max-w-2xl mx-auto p-4">
            <div className="mb-4 bg-white rounded-2xl shadow-lg p-4 flex items-center gap-3">
              <button
                onClick={() => setView('stats')}
                className="p-2 rounded-lg hover:bg-gray-100"
                title="Назад"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h2 className="text-xl font-semibold">{activityMeta?.label || 'Раздел активности'}</h2>
              </div>
            </div>

            <StatsActivityDetail
              selectedType={selectedStatsActivityType}
              activities={activities}
              weekStartDate={selectedStatsWeekStart}
              onWeekStartChange={setSelectedStatsWeekStart}
              babyBirthDate={babyProfile.birthDate}
            />
          </div>
        </div>
        {renderBottomNavigation()}
      </>
    );
  }

  if (view === 'notifications') {
    return (
      <>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Загрузка уведомлений...</div>}>
          <NotificationsView
            tg={tg}
            onBack={() => {
              if (tg) tg.HapticFeedback?.impactOccurred('light');
              setView('main');
            }}
            showBackButton={false}
            activityTypes={activityTypes}
            notificationHelpers={notificationHelpers}
            isAuthenticated={isAuthenticated}
            initialNotifications={notifications}
            onNotificationsChange={setNotifications}
            userSettings={userSettings}
          />
        </Suspense>
        {renderBottomNavigation()}
      </>
    );
  }

  if (view === 'settings') {
    return (
      <>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Загрузка настроек...</div>}>
          <SettingsView
            tg={tg}
            isTelegramApp={Platform.isTelegram()}
            onBack={() => navigateTo('main')}
            userEmail={currentUser?.email || ''}
            settings={userSettings}
            onLanguageChange={handleLanguageChange}
            onThemeChange={handleThemeChange}
            onSystemNotificationToggle={handleSystemNotificationToggle}
            onPasswordChange={handlePasswordChange}
            onSupportClick={handleSupportClick}
            onLogout={handleLogout}
          />
        </Suspense>
        {renderBottomNavigation()}
      </>
    );
  }

  return (
    <>
{ENV.isDevelopment && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%)',
          color: 'white',
          padding: '10px 16px',
          textAlign: 'center',
          zIndex: 99999,
          fontSize: '13px',
          fontWeight: '600',
          boxShadow: '0 2px 8px rgba(255, 107, 0, 0.3)',
          borderBottom: '2px solid #ff8c00'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🔧</span>
            <span>DEVELOPMENT MODE - используйте dev-test-1@example.com</span>
            <span style={{ fontSize: '18px' }}>🔧</span>
          </div>
        </div>
      )}
          
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-28">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 bg-white rounded-2xl shadow-lg p-4">
          <button
            onClick={() => navigateTo('profile')}
            className="flex items-center text-left rounded-xl p-1 -m-1 active:scale-[0.98] transition-transform"
            title="Открыть профиль малыша"
          >
            <div className="w-11 h-11 rounded-full bg-purple-100 flex items-center justify-center overflow-hidden mr-3">
              {babyProfile.photo ? (
                <img src={babyProfile.photo} alt="Фото малыша" className="w-full h-full object-cover" />
              ) : (
                <Baby className="w-6 h-6 text-purple-600" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800 leading-tight">
                {babyProfile.name || 'Трекер малыша'}
              </h1>
              <div className="text-xs text-gray-500 mt-1">
                {babyProfile.birthDate ? `${babyProfile.birthDate} · ${calculateAge()}` : 'Добавьте дату рождения'}
              </div>
            </div>
          </button>
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
            {recentCompletedActivities.slice(0, 10).map((activity) => renderRecentActivityCard(activity))}
            {recentCompletedActivities.length === 0 && (
              <div className="text-center text-gray-500 py-8">Добавьте первую запись</div>
            )}
          </div>
        </div>
      </div>
      </div>
      {renderBottomNavigation()}
    </>
  );
};

export default ActivityTracker;
