import React, { useState, useEffect, useCallback } from 'react';
import { Baby, Milk, Moon, Bath, Wind, Droplets, Pill, BarChart3, ArrowLeft, Play, Pause, Edit2, Trash2, X } from 'lucide-react';
import * as supabaseModule from './utils/supabaseModule.supabase.js';

const ActivityTracker = () => {
  const [activities, setActivities] = useState([]);
  const [view, setView] = useState('main');
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [timers, setTimers] = useState({});
  const [pausedTimers, setPausedTimers] = useState({});
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

  const activityTypes = {
    breastfeeding: { icon: Baby, label: 'Кормление грудью', color: 'bg-pink-100 text-pink-600' },
    bottle: { icon: Milk, label: 'Бутылочка', color: 'bg-blue-100 text-blue-600' },
    sleep: { icon: Moon, label: 'Сон', color: 'bg-indigo-100 text-indigo-600' },
    bath: { icon: Bath, label: 'Купание', color: 'bg-cyan-100 text-cyan-600' },
    walk: { icon: Wind, label: 'Прогулка', color: 'bg-green-100 text-green-600' },
    diaper: { icon: Droplets, label: 'Подгузник', color: 'bg-yellow-100 text-yellow-600' },
    medicine: { icon: Pill, label: 'Лекарство', color: 'bg-red-100 text-red-600' },
  };

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
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}ч ${minutes}м` : `${minutes}м`;
  };

  const getTimerDuration = (startTime, pausedDuration = 0) => {
    const diff = Date.now() - startTime + pausedDuration;
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

  // Convert Supabase activity to app format
  const convertFromSupabaseActivity = (dbActivity) => {
    return {
      id: dbActivity.id,
      type: dbActivity.type,
      startTime: dbActivity.start_time,
      endTime: dbActivity.end_time,
      comment: dbActivity.comment,
      date: new Date(dbActivity.start_time).toLocaleDateString('ru-RU'),
      // Type-specific fields
      leftDuration: dbActivity.left_duration,
      rightDuration: dbActivity.right_duration,
      foodType: dbActivity.food_type,
      amount: dbActivity.amount,
      diaperType: dbActivity.diaper_type,
      medicineName: dbActivity.medicine_name,
    };
  };

  // Convert app activity to Supabase format
  const convertToSupabaseActivity = (activity) => {
    return {
      type: activity.type,
      startTime: activity.startTime,
      endTime: activity.endTime,
      comment: activity.comment,
      // Type-specific fields
      leftDuration: activity.leftDuration,
      rightDuration: activity.rightDuration,
      foodType: activity.foodType,
      amount: activity.amount ? parseInt(activity.amount) : null,
      diaperType: activity.diaperType,
      medicineName: activity.medicineName,
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

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    
    // Set a timeout to prevent infinite loading
    const loadTimeout = setTimeout(() => {
      console.warn('Load timeout - falling back to localStorage');
      setAuthError('Превышено время ожидания');
      loadFromLocalStorage();
      setIsLoading(false);
    }, 10000); // 10 seconds timeout
    
    try {
      // Check if we're in Telegram and if Supabase is configured
      const hasSupabase = supabaseModule.authHelpers && typeof supabaseModule.authHelpers.signInWithTelegram === 'function';
      
      if (hasSupabase && window.Telegram?.WebApp?.initDataUnsafe?.user) {
        const telegramUser = window.Telegram.WebApp.initDataUnsafe.user;
        
        try {
          const { data, error } = await supabaseModule.authHelpers.signInWithTelegram(telegramUser);
          
          if (error) {
            console.error('Auth error:', error);
            setAuthError('Ошибка аутентификации - используется localStorage');
            loadFromLocalStorage();
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
          }
          
          setIsAuthenticated(true);
          
          // Load baby profile
          try {
            const profileResult = await supabaseModule.supabaseModule.babyHelpers.getProfile();
            if (profileResult.data) {
              setBabyProfile({
                name: profileResult.data.name || '',
                birthDate: profileResult.data.birth_date || '',
                photo: profileResult.data.photo_url || null,
              });
            }
          } catch (err) {
            console.error('Profile load error:', err);
          }
          
          // Load activities
          try {
            const activitiesResult = await supabaseModule.supabaseModule.activityHelpers.getActivities();
            if (activitiesResult.data) {
              setActivities(activitiesResult.data.map(convertFromSupabaseActivity));
            }
          } catch (err) {
            console.error('Activities load error:', err);
          }
          
          // Load growth records
          try {
            const growthResult = await supabaseModule.supabaseModule.growthHelpers.getRecords();
            if (growthResult.data) {
              setGrowthData(growthResult.data.map(convertFromSupabaseGrowth));
            }
          } catch (err) {
            console.error('Growth load error:', err);
          }
          
          // Load timers from localStorage (they're temporary, not in DB)
          const savedTimers = localStorage.getItem('active_timers');
          const savedPaused = localStorage.getItem('paused_timers');
          if (savedTimers) setTimers(JSON.parse(savedTimers));
          if (savedPaused) setPausedTimers(JSON.parse(savedPaused));
          
        } catch (supabaseError) {
          console.error('Supabase error:', supabaseError);
          setAuthError('Supabase недоступен - используется localStorage');
          loadFromLocalStorage();
        }
      } else {
        // Not in Telegram or Supabase not configured, use localStorage
        console.log('Using localStorage (no Telegram or Supabase)');
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
    const savedProfile = localStorage.getItem('baby_profile');
    const savedGrowth = localStorage.getItem('growth_data');
    
    if (savedActivities) setActivities(JSON.parse(savedActivities));
    if (savedTimers) setTimers(JSON.parse(savedTimers));
    if (savedPaused) setPausedTimers(JSON.parse(savedPaused));
    if (savedProfile) setBabyProfile(JSON.parse(savedProfile));
    if (savedGrowth) setGrowthData(JSON.parse(savedGrowth));
  };

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
    if (timers[timerType]) {
      return Math.floor((Date.now() - timers[timerType]) / 1000);
    }
    return Math.floor((pausedTimers[timerType] || 0) / 1000);
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
  };

  const saveActivity = useCallback(async () => {
    if (tg) tg.HapticFeedback?.notificationOccurred('success');
    
    // Validate required fields
    if (!formData.type || !formData.startTime) {
      if (tg) tg.HapticFeedback?.notificationOccurred('error');
      alert('Пожалуйста, заполните обязательные поля');
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

      activityData.leftDuration = leftDuration;
      activityData.rightDuration = rightDuration;
      activityData.endTime = new Date(new Date(formData.startTime).getTime() + (leftDuration + rightDuration) * 1000).toISOString();
      
      if (!editingId) {
        resetTimer('left');
        resetTimer('right');
      }
    } else if (formData.type === 'sleep' || formData.type === 'walk') {
      const timerKey = formData.type;
      if (!editingId && (timers[timerKey] || pausedTimers[timerKey])) {
        const duration = getTotalDuration(timerKey);
        activityData.endTime = new Date(new Date(formData.startTime).getTime() + duration * 1000).toISOString();
        resetTimer(timerKey);
      } else if (formData.endTime) {
        activityData.endTime = formData.endTime;
      } else {
        activityData.endTime = new Date().toISOString();
      }
    } else if (!['bath', 'diaper', 'medicine'].includes(formData.type) && !activityData.endTime) {
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
        // Fallback to local storage
        if (editingId) {
          setActivities(prev => prev.map(a => a.id === editingId ? activityData : a));
        } else {
          setActivities(prev => [activityData, ...prev]);
        }
        localStorage.setItem('baby_activities', JSON.stringify(activities));
      }
    } catch (error) {
      console.error('Save activity error:', error);
      if (tg) tg.HapticFeedback?.notificationOccurred('error');
      alert('Ошибка сохранения активности');
      return;
    }
    
    setView('main');
    setSelectedActivity(null);
    setFormData({});
    setEditingId(null);
  }, [formData, tg, timers, pausedTimers, editingId, getTotalDuration, resetTimer, isAuthenticated, activities]);

  const deleteActivity = async (id) => {
    if (tg) tg.HapticFeedback?.notificationOccurred('warning');
    if (window.confirm('Удалить эту запись?')) {
      try {
        if (isAuthenticated) {
          const { error } = await supabaseModule.activityHelpers.deleteActivity(id);
          if (error) throw error;
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

    if (view === 'main') {
      tg.BackButton.hide();
      tg.MainButton.hide();
    } else {
      tg.BackButton.show();
      tg.BackButton.onClick(handleBack);
      
      if (view === 'add') {
        tg.MainButton.setText(editingId ? 'Обновить' : 'Сохранить');
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
  }, [view, tg, handleBack, saveActivity, editingId]);

  useEffect(() => {
    if (!isLoading) {
      // Only save timers to localStorage (they're temporary)
      localStorage.setItem('active_timers', JSON.stringify(timers));
      localStorage.setItem('paused_timers', JSON.stringify(pausedTimers));
    }
  }, [timers, pausedTimers, isLoading]);

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
    if (view === 'profile') {
      setProfileForm(babyProfile);
    }
  }, [view, babyProfile]);

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
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    
    setSelectedActivity(type);
    setEditingId(null);
    const now = new Date().toISOString();
    const baseData = { type, startTime: now, comment: '' };
    
    if (type === 'breastfeeding') {
      setFormData({ ...baseData, leftDuration: 0, rightDuration: 0, manualLeftMinutes: '', manualRightMinutes: '' });
    } else if (type === 'bottle') {
      setFormData({ ...baseData, foodType: 'breast_milk', amount: '' });
    } else if (type === 'diaper') {
      setFormData({ ...baseData, diaperType: 'wet' });
    } else if (type === 'medicine') {
      setFormData({ ...baseData, medicineName: '' });
    } else {
      setFormData(baseData);
    }
    
    setView('add');
  };

  const continueActivity = (type) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    setSelectedActivity(type);
    
    // Set form data with current timer values
    const now = new Date().toISOString();
    if (type === 'breastfeeding') {
      setFormData({ 
        type, 
        startTime: now, 
        comment: '',
        leftDuration: getTotalDuration('left'),
        rightDuration: getTotalDuration('right'),
        manualLeftMinutes: '',
        manualRightMinutes: ''
      });
    } else {
      setFormData({ 
        type, 
        startTime: now, 
        comment: '' 
      });
    }
    
    setView('add');
  };

  // Get time since last activity of this type
  const getTimeSinceLastActivity = (type) => {
    const typeActivities = activities.filter(a => a.type === type);
    if (typeActivities.length === 0) return null;
    
    // Find most recent activity
    const sortedActivities = typeActivities.sort((a, b) => {
      const timeA = a.endTime || a.startTime;
      const timeB = b.endTime || b.startTime;
      return new Date(timeB) - new Date(timeA);
    });
    
    const lastActivity = sortedActivities[0];
    const lastTime = lastActivity.endTime || lastActivity.startTime;
    if (!lastTime) return null;
    
    const now = Date.now();
    const lastTimeMs = new Date(lastTime).getTime();
    const diffMs = now - lastTimeMs;
    
    const hours = Math.floor(diffMs / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    
    if (hours > 0) {
      return `${hours}ч ${minutes}м назад`;
    } else if (minutes > 0) {
      return `${minutes}м назад`;
    } else {
      return 'только что';
    }
  };

  // Profile functions
  const saveProfile = useCallback(async () => {
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
    }
  }, [profileForm, tg, isAuthenticated]);

  const addGrowthRecord = useCallback(async () => {
    if (!growthForm.date) {
      alert('Укажите дату измерения');
      return;
    }
    if (!growthForm.weight && !growthForm.height) {
      alert('Укажите хотя бы один параметр (вес или рост)');
      return;
    }

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
          setGrowthData(prev => prev.map(r => r.id === editingGrowthId ? record : r));
        } else {
          setGrowthData(prev => [...prev, record].sort((a, b) => new Date(a.date) - new Date(b.date)));
        }
        localStorage.setItem('growth_data', JSON.stringify(growthData));
      }
      
      setEditingGrowthId(null);
      setGrowthForm({ date: '', weight: '', height: '' });
    } catch (error) {
      console.error('Save growth record error:', error);
      alert('Ошибка сохранения записи');
    }
  }, [growthForm, editingGrowthId, tg, isAuthenticated, growthData]);

  const deleteGrowthRecord = useCallback(async (id) => {
    if (window.confirm('Удалить запись?')) {
      if (tg) tg.HapticFeedback?.notificationOccurred('warning');
      
      try {
        if (isAuthenticated) {
          const { error } = await supabaseModule.growthHelpers.deleteRecord(id);
          if (error) throw error;
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

  const calculateAge = useCallback(() => {
    if (!babyProfile.birthDate) return '';
    const birth = new Date(babyProfile.birthDate);
    const now = new Date();
    const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
    const days = Math.floor((now - birth) / (1000 * 60 * 60 * 24));
    
    if (months < 1) {
      return `${days} дн.`;
    } else if (months < 12) {
      return `${months} мес.`;
    } else {
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      return remainingMonths > 0 ? `${years} г. ${remainingMonths} мес.` : `${years} г.`;
    }
  }, [babyProfile.birthDate]);

  const startTimer = (timerType, activityType) => {
    if (tg) tg.HapticFeedback?.impactOccurred('medium');
    const key = activityType === 'sleep' ? 'sleep' : activityType === 'walk' ? 'walk' : timerType;
    setTimers(prev => ({ ...prev, [key]: Date.now() - (pausedTimers[key] || 0) }));
  };

  const pauseTimer = (timerType, activityType) => {
    if (tg) tg.HapticFeedback?.impactOccurred('medium');
    const key = activityType === 'sleep' ? 'sleep' : activityType === 'walk' ? 'walk' : timerType;
    if (timers[key]) {
      setPausedTimers(prev => ({ ...prev, [key]: Date.now() - timers[key] }));
      setTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[key];
        return newTimers;
      });
    }
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
        <div className="pt-2" />
        
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center mb-6">
              <button 
                onClick={handleBack} 
                className="mr-3 p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <ActivityIcon className="w-6 h-6 mr-2" />
              <h2 className="text-xl font-semibold">{activityTypes[selectedActivity].label}</h2>
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
                            {timers[side] ? getTimerDuration(timers[side], pausedTimers[side]) : formatSeconds(getTotalDuration(side))}
                          </div>
                          <button
                            onClick={() => timers[side] ? pauseTimer(side, 'breastfeeding') : startTimer(side, 'breastfeeding')}
                            className={`w-full py-2 rounded-lg flex items-center justify-center mb-2 ${
                              timers[side] ? 'bg-red-500 text-white' : 'bg-pink-500 text-white'
                            }`}
                          >
                            {timers[side] ? <><Pause className="w-4 h-4 mr-2" />Стоп</> : <><Play className="w-4 h-4 mr-2" />Старт</>}
                          </button>
                          <input
                            type="number"
                            placeholder="или мин"
                            className="w-full border border-gray-300 rounded-lg p-2 text-center text-sm"
                            value={formData[`manual${side === 'left' ? 'Left' : 'Right'}Minutes`] || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, [`manual${side === 'left' ? 'Left' : 'Right'}Minutes`]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={toLocalDateTimeString(formData.startTime)}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))}
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

              {(selectedActivity === 'sleep' || selectedActivity === 'walk') && (
                <div className="space-y-4">
                  {!editingId && (
                    <div className="border-2 border-indigo-200 rounded-lg p-4">
                      <div className="text-2xl font-mono text-center mb-3">
                        {timers[selectedActivity] ? getTimerDuration(timers[selectedActivity], pausedTimers[selectedActivity]) : formatSeconds(getTotalDuration(selectedActivity))}
                      </div>
                      <button onClick={() => timers[selectedActivity] ? pauseTimer(selectedActivity, selectedActivity) : startTimer(selectedActivity, selectedActivity)} className={`w-full py-3 rounded-lg flex items-center justify-center ${timers[selectedActivity] ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'}`}>
                        {timers[selectedActivity] ? <><Pause className="w-5 h-5 mr-2" />Остановить</> : <><Play className="w-5 h-5 mr-2" />Запустить таймер</>}
                      </button>
                    </div>
                  )}
                  
                  {!editingId && <div className="text-center text-gray-500">или укажите вручную</div>}
                  
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input type="datetime-local" className="w-full border-2 border-gray-200 rounded-lg p-3" value={toLocalDateTimeString(formData.startTime)} onChange={(e) => setFormData(prev => ({ ...prev, startTime: fromLocalDateTimeString(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Время окончания:</label>
                    <input type="datetime-local" className="w-full border-2 border-gray-200 rounded-lg p-3" value={toLocalDateTimeString(formData.endTime)} onChange={(e) => setFormData(prev => ({ ...prev, endTime: fromLocalDateTimeString(e.target.value) }))} />
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

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleBack}
                  className="flex-1 bg-gray-500 text-white py-3 rounded-lg font-medium active:scale-95 transition-transform"
                >
                  Отмена
                </button>
                <button
                  onClick={saveActivity}
                  className="flex-1 bg-purple-600 text-white py-3 rounded-lg font-medium active:scale-95 transition-transform"
                >
                  {editingId ? 'Обновить' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'profile') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        <div className="pt-2" />
        
        <div className="max-w-2xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center mb-4 bg-white rounded-2xl shadow-lg p-4">
            <button 
              onClick={() => { 
                if (tg) tg.HapticFeedback?.impactOccurred('light'); 
                setView('main'); 
              }} 
              className="mr-3 p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200 transition-colors"
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
                    Возраст: {calculateAge()}
                  </div>
                )}
              </div>
              <button
                onClick={saveProfile}
                className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium active:scale-95 transition-transform"
              >
                Сохранить профиль
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
                  className="flex-1 bg-purple-600 text-white py-2 rounded-lg text-sm font-medium active:scale-95 transition-transform"
                >
                  {editingGrowthId ? 'Обновить' : 'Добавить'}
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

            {/* Simple Growth Chart */}
            {growthData.length > 1 && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="font-medium text-sm text-gray-700 mb-3">Динамика:</h4>
                <div className="space-y-4">
                  {/* Weight Chart */}
                  {growthData.some(r => r.weight) && (
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-2">Вес (кг)</div>
                      <div className="flex items-end justify-between h-32 border-b border-l border-gray-300 pl-2 pb-2">
                        {growthData.filter(r => r.weight).map((record, idx) => {
                          const maxWeight = Math.max(...growthData.filter(r => r.weight).map(r => r.weight));
                          const height = (record.weight / maxWeight) * 100;
                          return (
                            <div key={record.id} className="flex flex-col items-center flex-1 mx-1">
                              <div className="text-xs font-semibold mb-1">{record.weight}</div>
                              <div 
                                className="w-full bg-purple-400 rounded-t"
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
                  )}
                  
                  {/* Height Chart */}
                  {growthData.some(r => r.height) && (
                    <div>
                      <div className="text-sm font-medium text-gray-600 mb-2">Рост (см)</div>
                      <div className="flex items-end justify-between h-32 border-b border-l border-gray-300 pl-2 pb-2">
                        {growthData.filter(r => r.height).map((record, idx) => {
                          const maxHeight = Math.max(...growthData.filter(r => r.height).map(r => r.height));
                          const minHeight = Math.min(...growthData.filter(r => r.height).map(r => r.height));
                          const height = ((record.height - minHeight) / (maxHeight - minHeight)) * 100 || 50;
                          return (
                            <div key={record.id} className="flex flex-col items-center flex-1 mx-1">
                              <div className="text-xs font-semibold mb-1">{record.height}</div>
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

    // Get activities for a specific hour and day with minute-level precision
    const getActivitiesForCell = (day, hour) => {
      const dayStr = day.toLocaleDateString('ru-RU');
      const dayActivities = activities.filter(a => a.date === dayStr);
      
      return dayActivities.filter(activity => {
        if (!activity.startTime) return false;
        const startTime = new Date(activity.startTime);
        const startHour = startTime.getHours();
        
        if (activity.endTime) {
          const endTime = new Date(activity.endTime);
          const endHour = endTime.getHours();
          
          // Activity spans this hour or starts/ends in this hour
          if (startHour <= hour && endHour >= hour) {
            return true;
          }
        } else {
          // No end time, just check start hour
          return startHour === hour;
        }
        
        return false;
      });
    };

    // Get minute segments (0-59) for each activity in this hour
    const getHourSegments = (day, hour, cellActivities) => {
      const segments = Array(60).fill(null); // 60 minutes, each can have an activity
      
      cellActivities.forEach(activity => {
        if (!activity.startTime) return;
        
        const startTime = new Date(activity.startTime);
        const endTime = activity.endTime ? new Date(activity.endTime) : new Date(startTime.getTime() + 60000); // default 1 min
        
        const startHour = startTime.getHours();
        const startMinute = startTime.getMinutes();
        const endHour = endTime.getHours();
        const endMinute = endTime.getMinutes();
        
        // Calculate which minutes in this hour are covered by this activity
        let firstMinute = 0;
        let lastMinute = 59;
        
        if (startHour === hour) {
          firstMinute = startMinute;
        }
        
        if (endHour === hour) {
          lastMinute = endMinute;
        } else if (endHour > hour) {
          lastMinute = 59;
        }
        
        // Fill the segments for this activity
        for (let min = firstMinute; min <= lastMinute; min++) {
          if (!segments[min]) { // Don't overwrite if another activity already claimed this minute
            segments[min] = activity.type;
          }
        }
      });
      
      // Group consecutive segments of the same type
      const groupedSegments = [];
      let currentType = segments[0];
      let currentStart = 0;
      
      for (let i = 1; i <= 60; i++) {
        if (i === 60 || segments[i] !== currentType) {
          if (currentType !== null) {
            groupedSegments.push({
              type: currentType,
              startMinute: currentStart,
              endMinute: i - 1,
              width: ((i - currentStart) / 60) * 100 // percentage width
            });
          }
          if (i < 60) {
            currentType = segments[i];
            currentStart = i;
          }
        }
      }
      
      return groupedSegments;
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

      return stats;
    };

    const weekStats = getWeekStats();
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        <div className="pt-2" />
        
        <div className="max-w-7xl mx-auto px-4">
          {/* Header with back button */}
          <div className="flex items-center mb-4 bg-white rounded-2xl shadow-lg p-4">
            <button 
              onClick={handleBack} 
              className="mr-3 p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200 transition-colors"
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

          {/* Heatmap Table */}
          <div className="bg-white rounded-2xl shadow-lg p-4 mb-4 overflow-x-auto">
            <div className="min-w-max">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="p-2 text-xs font-semibold text-gray-600 border-b-2 border-gray-200 sticky left-0 bg-white z-10">Час</th>
                    {weekDays.map((day, i) => (
                      <th key={i} className="p-2 text-xs font-semibold text-gray-600 border-b-2 border-gray-200 min-w-16">
                        <div>{day.toLocaleDateString('ru-RU', { weekday: 'short' })}</div>
                        <div className="text-gray-400 font-normal">{day.getDate()}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <tr key={hour} className="hover:bg-gray-50">
                      <td className="p-1 text-xs text-gray-600 font-medium border-r border-gray-200 sticky left-0 bg-white">
                        {hour.toString().padStart(2, '0')}:00
                      </td>
                      {weekDays.map((day, i) => {
                        const cellActivities = getActivitiesForCell(day, hour);
                        const segments = getHourSegments(day, hour, cellActivities);
                        
                        return (
                          <td
                            key={i}
                            className="p-0 border border-gray-200 relative group"
                            style={{ height: '40px' }}
                          >
                            {segments.length > 0 ? (
                              <>
                                {/* Vertical timeline visualization */}
                                <div className="flex flex-col h-full w-full">
                                  {segments.map((segment, idx) => {
                                    const colorClass = activityTypes[segment.type]?.color.replace('bg-', '') || 'gray-200';
                                    const bgColor = colorClass.includes('pink') ? 'bg-pink-200' :
                                                   colorClass.includes('blue') ? 'bg-blue-200' :
                                                   colorClass.includes('indigo') ? 'bg-indigo-200' :
                                                   colorClass.includes('cyan') ? 'bg-cyan-200' :
                                                   colorClass.includes('green') ? 'bg-green-200' :
                                                   colorClass.includes('yellow') ? 'bg-yellow-200' :
                                                   colorClass.includes('red') ? 'bg-red-200' : 'bg-gray-200';
                                    
                                    return (
                                      <div
                                        key={idx}
                                        className={`${bgColor} border-b border-white last:border-b-0`}
                                        style={{ height: `${segment.width}%` }}
                                        title={`${activityTypes[segment.type]?.label}: ${segment.startMinute}-${segment.endMinute} мин`}
                                      />
                                    );
                                  })}
                                </div>
                                
                                {/* Tooltip on hover */}
                                <div className="absolute left-0 top-full mt-1 bg-gray-900 text-white text-xs rounded-lg p-2 hidden group-hover:block z-20 whitespace-nowrap shadow-lg">
                                  {cellActivities.map((act, idx) => {
                                    const ActivityIcon = activityTypes[act.type]?.icon;
                                    const startTime = new Date(act.startTime);
                                    const endTime = act.endTime ? new Date(act.endTime) : null;
                                    
                                    let timeRange = '';
                                    if (startTime.getHours() === hour && endTime && endTime.getHours() === hour) {
                                      timeRange = `${startTime.getMinutes().toString().padStart(2, '0')}-${endTime.getMinutes().toString().padStart(2, '0')}`;
                                    } else if (startTime.getHours() === hour) {
                                      timeRange = `${startTime.getMinutes().toString().padStart(2, '0')}-59`;
                                    } else if (endTime && endTime.getHours() === hour) {
                                      timeRange = `00-${endTime.getMinutes().toString().padStart(2, '0')}`;
                                    } else {
                                      timeRange = '00-59';
                                    }
                                    
                                    return (
                                      <div key={idx} className="flex items-center gap-2 mb-1 last:mb-0">
                                        {ActivityIcon && <ActivityIcon className="w-3 h-3" />}
                                        <span>{activityTypes[act.type]?.label}</span>
                                        <span className="text-gray-400">({timeRange})</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            ) : (
                              <div className="h-full bg-gray-50"></div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="bg-white rounded-2xl shadow-lg p-4 mb-4">
            <h3 className="text-sm font-semibold mb-3 text-gray-700">Легенда</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(activityTypes).map(([key, data]) => {
                const Icon = data.icon;
                return (
                  <div key={key} className={`${data.color} rounded-lg p-2 flex items-center gap-2`}>
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs font-medium">{data.label}</span>
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
                  return (
                    <div key={type} className={`${activityTypes[type]?.color} rounded-lg p-3`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {ActivityIcon && <ActivityIcon className="w-5 h-5" />}
                          <span className="font-semibold">{activityTypes[type]?.label}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{data.count} раз</div>
                          {data.totalDuration > 0 && (
                            <div className="text-sm opacity-75">
                              {formatDuration(0, data.totalDuration)}
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-6">
      <div className="pt-4" />
      
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
            {activities.slice(0, 10).map(activity => {
              const ActivityIcon = activityTypes[activity.type].icon;
              return (
                <div key={activity.id} className={`${activityTypes[activity.type].color} rounded-lg p-3`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start flex-1 min-w-0">
                      <ActivityIcon className="w-5 h-5 mr-3 mt-1 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{activityTypes[activity.type].label}</div>
                        <div className="text-sm opacity-75">
                          {activity.startTime && formatTime(activity.startTime)}
                          {activity.endTime && activity.startTime && ` - ${formatTime(activity.endTime)} (${formatDuration(activity.startTime, activity.endTime)})`}
                        </div>
                        {activity.type === 'breastfeeding' && (
                          <div className="text-sm opacity-75">Л: {Math.floor(activity.leftDuration / 60)}м, П: {Math.floor(activity.rightDuration / 60)}м</div>
                        )}
                        {activity.foodType && (
                          <div className="text-sm opacity-75">{activity.foodType === 'breast_milk' ? 'Грудное молоко' : activity.foodType === 'formula' ? 'Смесь' : 'Вода'}</div>
                        )}
                        {activity.amount && <div className="text-sm opacity-75">Количество: {activity.amount} мл</div>}
                        {activity.diaperType && <div className="text-sm opacity-75">{activity.diaperType === 'wet' ? 'Мокрый' : 'Грязный'}</div>}
                        {activity.medicineName && <div className="text-sm opacity-75">{activity.medicineName}</div>}
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
    </div>
  );
};

export default ActivityTracker;