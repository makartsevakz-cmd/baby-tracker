import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Baby, Milk, Moon, Bath, Wind, Droplets, Pill, Plus, BarChart3, ChevronLeft, Play, Pause, Save } from 'lucide-react';

const ActivityTracker = () => {
  const [activities, setActivities] = useState([]);
  const [view, setView] = useState('main');
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [timers, setTimers] = useState({});
  const [formData, setFormData] = useState({});
  const [tg, setTg] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Инициализация Telegram WebApp
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const telegram = window.Telegram.WebApp;
      telegram.ready();
      telegram.expand();
      telegram.enableClosingConfirmation();
      
      telegram.setHeaderColor('#9333ea');
      telegram.setBackgroundColor('#faf5ff');
      
      setTg(telegram);
      
      telegram.MainButton.setText('Добавить активность');
      telegram.MainButton.hide();
      
      telegram.BackButton.onClick(() => {
        if (view !== 'main') {
          setView('main');
          setSelectedActivity(null);
          setFormData({});
        }
      });
    }

    loadData();
  }, []);

  // Функция загрузки данных из Telegram Cloud Storage
  const loadData = useCallback(async () => {
    setIsLoading(true);
    
    if (window.Telegram?.WebApp?.CloudStorage) {
      try {
        // Загружаем активности
        window.Telegram.WebApp.CloudStorage.getItem('baby_activities', (error, value) => {
          if (!error && value) {
            try {
              const parsed = JSON.parse(value);
              setActivities(parsed);
              console.log('Загружено активностей:', parsed.length);
            } catch (e) {
              console.error('Ошибка парсинга активностей:', e);
            }
          }
        });

        // Загружаем таймеры
        window.Telegram.WebApp.CloudStorage.getItem('active_timers', (error, value) => {
          if (!error && value) {
            try {
              const parsed = JSON.parse(value);
              setTimers(parsed);
              console.log('Загружены таймеры:', parsed);
            } catch (e) {
              console.error('Ошибка парсинга таймеров:', e);
            }
          }
          setIsLoading(false);
        });
      } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        setIsLoading(false);
      }
    } else {
      // Fallback на localStorage если CloudStorage недоступен
      try {
        const savedActivities = localStorage.getItem('baby_activities');
        const savedTimers = localStorage.getItem('active_timers');
        
        if (savedActivities) {
          setActivities(JSON.parse(savedActivities));
        }
        if (savedTimers) {
          setTimers(JSON.parse(savedTimers));
        }
      } catch (e) {
        console.error('Ошибка загрузки из localStorage:', e);
      }
      setIsLoading(false);
    }
  }, []);

  // Функция сохранения данных в Telegram Cloud Storage
  const saveToCloud = useCallback((key, value) => {
    if (window.Telegram?.WebApp?.CloudStorage) {
      window.Telegram.WebApp.CloudStorage.setItem(key, JSON.stringify(value), (error, success) => {
        if (error) {
          console.error(`Ошибка сохранения ${key}:`, error);
          // Fallback на localStorage
          localStorage.setItem(key, JSON.stringify(value));
        } else {
          console.log(`Сохранено ${key}:`, success);
        }
      });
    } else {
      // Fallback на localStorage
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, []);

  // Сохранение активностей при изменении
  useEffect(() => {
    if (!isLoading && activities.length >= 0) {
      saveToCloud('baby_activities', activities);
    }
  }, [activities, isLoading, saveToCloud]);

  // Сохранение таймеров при изменении
  useEffect(() => {
    if (!isLoading && Object.keys(timers).length >= 0) {
      saveToCloud('active_timers', timers);
    }
  }, [timers, isLoading, saveToCloud]);

  // Управление кнопками Telegram
  useEffect(() => {
    if (!tg) return;

    if (view === 'main') {
      tg.BackButton.hide();
      tg.MainButton.hide();
    } else {
      tg.BackButton.show();
      
      if (view === 'add') {
        tg.MainButton.setText('Сохранить');
        tg.MainButton.show();
        tg.MainButton.onClick(saveActivity);
      } else {
        tg.MainButton.hide();
      }
    }

    return () => {
      if (tg.MainButton) {
        tg.MainButton.offClick(saveActivity);
      }
    };
  }, [view, tg]);

  // Обновление таймеров
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => ({ ...prev }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const formatDuration = (start, end) => {
    const diff = new Date(end) - new Date(start);
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}ч ${minutes}м` : `${minutes}м`;
  };

  const getTimerDuration = (startTime) => {
    const diff = Date.now() - startTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const startActivity = (type) => {
    if (tg) {
      tg.HapticFeedback.impactOccurred('light');
    }
    
    setSelectedActivity(type);
    setFormData({
      type,
      startTime: new Date().toISOString(),
      comment: '',
    });
    
    if (type === 'breastfeeding') {
      setFormData(prev => ({ ...prev, leftDuration: 0, rightDuration: 0 }));
    } else if (type === 'bottle') {
      setFormData(prev => ({ ...prev, foodType: 'breast_milk' }));
    } else if (type === 'diaper') {
      setFormData(prev => ({ ...prev, diaperType: 'wet' }));
    } else if (type === 'medicine') {
      setFormData(prev => ({ ...prev, medicineName: '' }));
    }
    
    setView('add');
  };

  const startTimer = (timerType) => {
    if (tg) {
      tg.HapticFeedback.impactOccurred('medium');
    }
    setTimers(prev => ({
      ...prev,
      [timerType]: Date.now()
    }));
  };

  const stopTimer = (timerType) => {
    if (tg) {
      tg.HapticFeedback.impactOccurred('medium');
    }
    if (timers[timerType]) {
      const duration = Math.floor((Date.now() - timers[timerType]) / 1000);
      setTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[timerType];
        return newTimers;
      });
      return duration;
    }
    return 0;
  };

  const saveActivity = () => {
    if (tg) {
      tg.HapticFeedback.notificationOccurred('success');
    }
    
    const newActivity = {
      id: Date.now(),
      ...formData,
      date: new Date(formData.startTime).toLocaleDateString('ru-RU'),
    };

    if (formData.type === 'breastfeeding' && (timers.left || timers.right)) {
      if (timers.left) newActivity.leftDuration += stopTimer('left');
      if (timers.right) newActivity.rightDuration += stopTimer('right');
      newActivity.endTime = new Date().toISOString();
    } else if ((formData.type === 'sleep' || formData.type === 'walk') && timers.main) {
      stopTimer('main');
      newActivity.endTime = new Date().toISOString();
    } else if (!['bath', 'diaper', 'medicine'].includes(formData.type) && !newActivity.endTime) {
      newActivity.endTime = new Date().toISOString();
    }

    setActivities(prev => {
      const updated = [newActivity, ...prev];
      console.log('Сохранение новой активности, всего:', updated.length);
      return updated;
    });
    
    setView('main');
    setSelectedActivity(null);
    setFormData({});
  };

  const getTodayStats = () => {
    const today = new Date().toLocaleDateString('ru-RU');
    const todayActivities = activities.filter(a => a.date === today);
    
    const stats = {};
    todayActivities.forEach(activity => {
      if (!stats[activity.type]) {
        stats[activity.type] = { count: 0, totalDuration: 0 };
      }
      stats[activity.type].count++;
      
      if (activity.startTime && activity.endTime) {
        const duration = new Date(activity.endTime) - new Date(activity.startTime);
        stats[activity.type].totalDuration += duration;
      } else if (activity.type === 'breastfeeding') {
        stats[activity.type].totalDuration += (activity.leftDuration + activity.rightDuration) * 1000;
      }
    });
    
    return stats;
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

  if (view === 'add' && selectedActivity) {
    const ActivityIcon = activityTypes[selectedActivity].icon;
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-4 pb-20">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center mb-6">
              <ActivityIcon className="w-6 h-6 mr-2" />
              <h2 className="text-xl font-semibold">{activityTypes[selectedActivity].label}</h2>
            </div>

            <div className="space-y-4">
              {selectedActivity === 'breastfeeding' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border-2 border-pink-200 rounded-lg p-4">
                      <div className="text-center mb-2 font-medium">Левая грудь</div>
                      <div className="text-2xl font-mono text-center mb-3">
                        {timers.left ? getTimerDuration(timers.left) : '00:00:00'}
                      </div>
                      <button
                        onClick={() => timers.left ? stopTimer('left') : startTimer('left')}
                        className={`w-full py-2 rounded-lg flex items-center justify-center ${
                          timers.left ? 'bg-red-500 text-white' : 'bg-pink-500 text-white'
                        }`}
                      >
                        {timers.left ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                        {timers.left ? 'Стоп' : 'Старт'}
                      </button>
                    </div>
                    
                    <div className="border-2 border-pink-200 rounded-lg p-4">
                      <div className="text-center mb-2 font-medium">Правая грудь</div>
                      <div className="text-2xl font-mono text-center mb-3">
                        {timers.right ? getTimerDuration(timers.right) : '00:00:00'}
                      </div>
                      <button
                        onClick={() => timers.right ? stopTimer('right') : startTimer('right')}
                        className={`w-full py-2 rounded-lg flex items-center justify-center ${
                          timers.right ? 'bg-red-500 text-white' : 'bg-pink-500 text-white'
                        }`}
                      >
                        {timers.right ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                        {timers.right ? 'Стоп' : 'Старт'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedActivity === 'bottle' && (
                <div className="space-y-4">
                  <div>
                    <label className="block mb-2 font-medium">Чем кормили:</label>
                    <select
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.foodType || 'breast_milk'}
                      onChange={(e) => setFormData(prev => ({ ...prev, foodType: e.target.value }))}
                    >
                      <option value="breast_milk">Грудное молоко</option>
                      <option value="formula">Смесь</option>
                      <option value="water">Вода</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.startTime ? new Date(formData.startTime).toISOString().slice(0, 16) : ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: new Date(e.target.value).toISOString() }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Время окончания:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.endTime ? new Date(formData.endTime).toISOString().slice(0, 16) : ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, endTime: new Date(e.target.value).toISOString() }))}
                    />
                  </div>
                </div>
              )}

              {(selectedActivity === 'sleep' || selectedActivity === 'walk') && (
                <div className="space-y-4">
                  <div className="border-2 border-indigo-200 rounded-lg p-4">
                    <div className="text-2xl font-mono text-center mb-3">
                      {timers.main ? getTimerDuration(timers.main) : '00:00:00'}
                    </div>
                    <button
                      onClick={() => timers.main ? stopTimer('main') : startTimer('main')}
                      className={`w-full py-3 rounded-lg flex items-center justify-center ${
                        timers.main ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white'
                      }`}
                    >
                      {timers.main ? <Pause className="w-5 h-5 mr-2" /> : <Play className="w-5 h-5 mr-2" />}
                      {timers.main ? 'Остановить' : 'Запустить таймер'}
                    </button>
                  </div>
                  
                  <div className="text-center text-gray-500">или укажите вручную</div>
                  
                  <div>
                    <label className="block mb-2 font-medium">Время начала:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.startTime ? new Date(formData.startTime).toISOString().slice(0, 16) : ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, startTime: new Date(e.target.value).toISOString() }))}
                    />
                  </div>
                  <div>
                    <label className="block mb-2 font-medium">Время окончания:</label>
                    <input
                      type="datetime-local"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.endTime ? new Date(formData.endTime).toISOString().slice(0, 16) : ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, endTime: new Date(e.target.value).toISOString() }))}
                    />
                  </div>
                </div>
              )}

              {selectedActivity === 'diaper' && (
                <div>
                  <label className="block mb-2 font-medium">Тип:</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setFormData(prev => ({ ...prev, diaperType: 'wet' }))}
                      className={`py-3 rounded-lg border-2 ${
                        formData.diaperType === 'wet' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200'
                      }`}
                    >
                      Мокрый
                    </button>
                    <button
                      onClick={() => setFormData(prev => ({ ...prev, diaperType: 'dirty' }))}
                      className={`py-3 rounded-lg border-2 ${
                        formData.diaperType === 'dirty' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200'
                      }`}
                    >
                      Грязный
                    </button>
                  </div>
                </div>
              )}

              {selectedActivity === 'medicine' && (
                <div>
                  <label className="block mb-2 font-medium">Название лекарства:</label>
                  <input
                    type="text"
                    className="w-full border-2 border-gray-200 rounded-lg p-3"
                    value={formData.medicineName || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, medicineName: e.target.value }))}
                    placeholder="Введите название"
                  />
                </div>
              )}

              <div>
                <label className="block mb-2 font-medium">Комментарий:</label>
                <textarea
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  rows="3"
                  value={formData.comment || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Добавьте заметку..."
                />
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
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-4 pb-20">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center mb-6">
              <BarChart3 className="w-6 h-6 mr-2" />
              <h2 className="text-xl font-semibold">Статистика за сегодня</h2>
            </div>

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
                      {data.totalDuration > 0 && (
                        <div>Общее время: {formatDuration(0, data.totalDuration)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {Object.keys(stats).length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  Сегодня еще нет записей
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 p-4 pb-20">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Трекер малыша</h1>
            <button
              onClick={() => {
                if (tg) tg.HapticFeedback.impactOccurred('light');
                setView('stats');
              }}
              className="bg-purple-500 text-white p-3 rounded-lg"
            >
              <BarChart3 className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {Object.entries(activityTypes).map(([key, { icon: Icon, label, color }]) => (
              <button
                key={key}
                onClick={() => startActivity(key)}
                className={`${color} p-4 rounded-lg flex flex-col items-center justify-center transition-transform active:scale-95`}
              >
                <Icon className="w-8 h-8 mb-2" />
                <span className="text-sm font-medium text-center">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Последние записи ({activities.length})</h2>
          <div className="space-y-3">
            {activities.slice(0, 10).map(activity => {
              const ActivityIcon = activityTypes[activity.type].icon;
              return (
                <div key={activity.id} className={`${activityTypes[activity.type].color} rounded-lg p-3`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start flex-1">
                      <ActivityIcon className="w-5 h-5 mr-3 mt-1" />
                      <div className="flex-1">
                        <div className="font-medium">{activityTypes[activity.type].label}</div>
                        <div className="text-sm opacity-75">
                          {activity.startTime && formatTime(activity.startTime)}
                          {activity.endTime && activity.startTime && ` - ${formatTime(activity.endTime)}`}
                          {activity.endTime && activity.startTime && ` (${formatDuration(activity.startTime, activity.endTime)})`}
                        </div>
                        {activity.type === 'breastfeeding' && (
                          <div className="text-sm opacity-75">
                            Л: {Math.floor(activity.leftDuration / 60)}м, П: {Math.floor(activity.rightDuration / 60)}м
                          </div>
                        )}
                        {activity.foodType && (
                          <div className="text-sm opacity-75">
                            {activity.foodType === 'breast_milk' ? 'Грудное молоко' : 
                             activity.foodType === 'formula' ? 'Смесь' : 'Вода'}
                          </div>
                        )}
                        {activity.diaperType && (
                          <div className="text-sm opacity-75">
                            {activity.diaperType === 'wet' ? 'Мокрый' : 'Грязный'}
                          </div>
                        )}
                        {activity.medicineName && (
                          <div className="text-sm opacity-75">{activity.medicineName}</div>
                        )}
                        {activity.comment && (
                          <div className="text-sm opacity-75 mt-1">{activity.comment}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            
            {activities.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                Добавьте первую запись
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityTracker;