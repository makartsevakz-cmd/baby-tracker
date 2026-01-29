import React, { useState, useEffect, useCallback } from 'react';
import { Baby, Milk, Moon, Bath, Wind, Droplets, Pill, BarChart3, ArrowLeft, Play, Pause, Edit2, Trash2, X } from 'lucide-react';

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

  const saveToCloud = useCallback((key, value) => {
    if (window.Telegram?.WebApp?.CloudStorage) {
      window.Telegram.WebApp.CloudStorage.setItem(key, JSON.stringify(value), (error) => {
        if (error) {
          console.error(`Ошибка сохранения ${key}:`, error);
          localStorage.setItem(key, JSON.stringify(value));
        }
      });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, []);

  const loadData = useCallback(() => {
    setIsLoading(true);
    
    if (window.Telegram?.WebApp?.CloudStorage) {
      window.Telegram.WebApp.CloudStorage.getItem('baby_activities', (error, value) => {
        if (!error && value) {
          try {
            setActivities(JSON.parse(value));
          } catch (e) {
            console.error('Ошибка парсинга:', e);
          }
        }
      });

      window.Telegram.WebApp.CloudStorage.getItem('active_timers', (error, value) => {
        if (!error && value) {
          try {
            setTimers(JSON.parse(value));
          } catch (e) {
            console.error('Ошибка парсинга:', e);
          }
        }
      });

      window.Telegram.WebApp.CloudStorage.getItem('paused_timers', (error, value) => {
        if (!error && value) {
          try {
            setPausedTimers(JSON.parse(value));
          } catch (e) {
            console.error('Ошибка парсинга:', e);
          }
        }
        setIsLoading(false);
      });
    } else {
      const savedActivities = localStorage.getItem('baby_activities');
      const savedTimers = localStorage.getItem('active_timers');
      const savedPaused = localStorage.getItem('paused_timers');
      
      if (savedActivities) setActivities(JSON.parse(savedActivities));
      if (savedTimers) setTimers(JSON.parse(savedTimers));
      if (savedPaused) setPausedTimers(JSON.parse(savedPaused));
      setIsLoading(false);
    }
  }, []);

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

  const saveActivity = useCallback(() => {
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

    if (editingId) {
      setActivities(prev => prev.map(a => a.id === editingId ? activityData : a));
    } else {
      setActivities(prev => [activityData, ...prev]);
    }
    
    setView('main');
    setSelectedActivity(null);
    setFormData({});
    setEditingId(null);
  }, [formData, tg, timers, pausedTimers, editingId, getTotalDuration, resetTimer]);

  const deleteActivity = (id) => {
    if (tg) tg.HapticFeedback?.notificationOccurred('warning');
    if (window.confirm('Удалить эту запись?')) {
      setActivities(prev => prev.filter(a => a.id !== id));
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

    // Hide Telegram navigation buttons since we're using custom header
    tg.BackButton.hide();
    tg.MainButton.hide();

    return () => {
      tg.BackButton.offClick(handleBack);
      tg.MainButton.offClick(saveActivity);
    };
  }, [view, tg, handleBack, saveActivity, editingId]);

  useEffect(() => {
    if (!isLoading) {
      saveToCloud('baby_activities', activities);
      saveToCloud('active_timers', timers);
      saveToCloud('paused_timers', pausedTimers);
    }
  }, [activities, timers, pausedTimers, isLoading, saveToCloud]);

  useEffect(() => {
    const interval = setInterval(() => setTimers(prev => ({ ...prev })), 1000);
    return () => clearInterval(interval);
  }, []);

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
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
        {/* Custom Header Bar */}
        <div className="bg-purple-600 text-white shadow-lg sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <button 
                onClick={handleBack} 
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-purple-700 active:bg-purple-800 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="font-medium">Назад</span>
              </button>
              <div className="flex items-center gap-2">
                <ActivityIcon className="w-6 h-6" />
                <h1 className="text-lg font-semibold">{activityTypes[selectedActivity].label}</h1>
              </div>
              <button
                onClick={saveActivity}
                className="px-4 py-2 bg-white text-purple-600 rounded-lg font-medium hover:bg-purple-50 active:bg-purple-100 transition-colors"
              >
                {editingId ? 'Обновить' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
        
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="bg-white rounded-2xl shadow-lg p-6">

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
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'stats') {
    const stats = getTodayStats();
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
        {/* Custom Header Bar */}
        <div className="bg-purple-600 text-white shadow-lg sticky top-0 z-10">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <button 
                onClick={handleBack} 
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-purple-700 active:bg-purple-800 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="font-medium">Назад</span>
              </button>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-6 h-6" />
                <h1 className="text-lg font-semibold">Статистика за сегодня</h1>
              </div>
              <div className="w-20"></div> {/* Spacer for symmetry */}
            </div>
          </div>
        </div>
        
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="space-y-4">
              {Object.entries(stats).map(([type, data]) => {
                const ActivityIcon = activityTypes[type].icon;
                return (
                  <div key={type} className={`${activityTypes[type].color} rounded-lg p-4`}>
                    <div className="flex items-center mb-2">
                      <ActivityIcon className="w-5 h-5 mr-2" />
                      <span className="font-semibold">{activityTypes[type].label}</span>
                    </div>
                    <div className="ml-7">
                      <div>Количество: {data.count}</div>
                      {data.totalDuration > 0 && <div>Общее время: {formatDuration(0, data.totalDuration)}</div>}
                      {data.totalAmount > 0 && <div>Общий объем: {data.totalAmount} мл</div>}
                    </div>
                  </div>
                );
              })}
              {Object.keys(stats).length === 0 && (
                <div className="text-center text-gray-500 py-8">Сегодня еще нет записей</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-6">
      <div className="max-w-2xl mx-auto px-4 pt-4">
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
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Трекер малыша</h1>
            <button onClick={() => { if (tg) tg.HapticFeedback?.impactOccurred('light'); setView('stats'); }} className="bg-purple-500 text-white p-3 rounded-lg active:scale-95 transition-transform">
              <BarChart3 className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(activityTypes).map(([key, data]) => {
              const Icon = data.icon;
              return (
                <button key={key} onClick={() => startActivity(key)} className={`${data.color} p-4 rounded-lg flex flex-col items-center justify-center transition-transform active:scale-95`}>
                  <Icon className="w-8 h-8 mb-2" />
                  <span className="text-sm font-medium text-center">{data.label}</span>
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
