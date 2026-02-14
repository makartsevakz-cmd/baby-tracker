// src/components/NotificationsView.jsx
import React, { useState, useEffect } from 'react';
import { Bell, Plus, Edit2, Trash2, Clock, Calendar, RefreshCw, ArrowLeft, X } from 'lucide-react';
import cacheService, { CACHE_TTL_SECONDS } from '../services/cacheService.js';
import { Platform } from '../utils/platform.js';

const NotificationsView = ({ 
  tg, 
  onBack, 
  showBackButton = true,
  activityTypes,
  notificationHelpers,
  isAuthenticated,
  initialNotifications = [],
  onNotificationsChange
}) => {
  const getCurrentLocalTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  const getDefaultFormData = () => ({
    activityType: 'breastfeeding',
    notificationType: 'time',
    enabled: true,
    notificationTime: getCurrentLocalTime(),
    repeatDays: [0, 1, 2, 3, 4, 5, 6],
    intervalMinutes: 180,
    title: '',
    message: '',
  });

  const isAndroid = Platform.isAndroid();

  const [notifications, setNotifications] = useState(initialNotifications);
  const [isLoading, setIsLoading] = useState(!initialNotifications.length);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [isSaving, setIsSaving] = useState(false); // Prevent double saves
  const [formData, setFormData] = useState(() => getDefaultFormData());

  const daysOfWeek = [
    { value: 0, label: 'Вс' },
    { value: 1, label: 'Пн' },
    { value: 2, label: 'Вт' },
    { value: 3, label: 'Ср' },
    { value: 4, label: 'Чт' },
    { value: 5, label: 'Пт' },
    { value: 6, label: 'Сб' },
  ];

  const loadNotifications = async () => {
    // Если уже есть данные из props - не показываем loader
    if (notifications.length === 0) {
      setIsLoading(true);
    }
    
    try {
      if (isAuthenticated && notificationHelpers) {
        const { data, error } = await notificationHelpers.getNotifications();
        if (data) {
          setNotifications(data);
          // Уведомляем родительский компонент
          if (onNotificationsChange) {
            onNotificationsChange(data);
          }
          await cacheService.set('notifications', data, CACHE_TTL_SECONDS);
        } else {
          console.error('Load notifications error:', error);
        }
      } else {
        const saved = await cacheService.get('notifications');
        if (saved) {
          setNotifications(saved);
          if (onNotificationsChange) {
            onNotificationsChange(saved);
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Обновляем из props при изменении
    if (initialNotifications.length > 0) {
      setNotifications(initialNotifications);
      setIsLoading(false);
    } else if (notificationHelpers) {
      // Загружаем только если нет данных в props
      loadNotifications();
    }
  }, [isAuthenticated, notificationHelpers, initialNotifications]);

  // ── Конвертация локальное ↔ UTC ──────────────────────────────────────────
  const localTimeToUTC = (localHHMM) => {
    if (!localHHMM) return localHHMM;
    const [h, m] = localHHMM.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  };

  const utcTimeToLocal = (utcHHMM) => {
    if (!utcHHMM) return utcHHMM;
    const [h, m] = utcHHMM.split(':').map(Number);
    const d = new Date();
    d.setUTCHours(h, m, 0, 0);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  // Сдвиг дней недели при смене суток из-за часового пояса
  const shiftDays = (days, shift) => {
    if (!days || shift === 0) return days;
    return days.map(d => ((d + shift) % 7 + 7) % 7);
  };

  const getDayShift = (localHHMM) => {
    if (!localHHMM) return 0;
    const [h] = localHHMM.split(':').map(Number);
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d.getUTCDate() - d.getDate(); // -1, 0, или +1
  };
  // ───────────────────────────────────────────────────────────────────────────

  const saveNotification = async () => {
    // Prevent double saves
    if (isSaving) {
      console.log('Already saving notification, ignoring duplicate request');
      return;
    }
    
    setIsSaving(true);
    
    if (tg) tg.HapticFeedback?.notificationOccurred('success');

    // Конвертируем время и дни в UTC перед сохранением в БД
    const dayShift = getDayShift(formData.notificationTime);
    const saveData = {
      ...formData,
      notificationTime: localTimeToUTC(formData.notificationTime),
      repeatDays: shiftDays(formData.repeatDays, dayShift),
    };

    const notificationData = {
      ...saveData,
      id: editingId || Date.now(),
    };

    try {
      if (isAuthenticated && notificationHelpers) {
        if (editingId) {
          const { data, error } = await notificationHelpers.updateNotification(editingId, saveData);
          if (error) throw error;
          const updated = notifications.map(n => n.id === editingId ? data : n);
          setNotifications(updated);
          if (onNotificationsChange) onNotificationsChange(updated);
        } else {
          const { data, error } = await notificationHelpers.createNotification(saveData);
          if (error) throw error;
          const updated = [data, ...notifications];
          setNotifications(updated);
          if (onNotificationsChange) onNotificationsChange(updated);
        }
      } else {
        // Fallback to cache
        if (editingId) {
          const updatedNotifications = notifications.map(n => n.id === editingId ? notificationData : n);
          setNotifications(updatedNotifications);
          if (onNotificationsChange) onNotificationsChange(updatedNotifications);
          await cacheService.set('notifications', updatedNotifications, CACHE_TTL_SECONDS);
        } else {
          const updatedNotifications = [notificationData, ...notifications];
          setNotifications(updatedNotifications);
          if (onNotificationsChange) onNotificationsChange(updatedNotifications);
          await cacheService.set('notifications', updatedNotifications, CACHE_TTL_SECONDS);
        }
      }
    } catch (error) {
      console.error('Save notification error:', error);
      alert('Ошибка сохранения уведомления');
      setIsSaving(false);
      return;
    }

    resetForm();
    setIsSaving(false);
  };

  const deleteNotification = async (id) => {
    if (tg) tg.HapticFeedback?.notificationOccurred('warning');
    if (!window.confirm('Удалить это уведомление?')) return;

    try {
      if (isAuthenticated && notificationHelpers) {
        const { error } = await notificationHelpers.deleteNotification(id);
        if (error) throw error;
      } else {
        const updated = notifications.filter(n => n.id !== id);
        await cacheService.set('notifications', updated, CACHE_TTL_SECONDS);
      }
      const updated = notifications.filter(n => n.id !== id);
      setNotifications(updated);
      if (onNotificationsChange) onNotificationsChange(updated);
    } catch (error) {
      console.error('Delete notification error:', error);
      alert('Ошибка удаления уведомления');
    }
  };

  const toggleNotification = async (id, enabled) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');

    try {
      if (isAuthenticated && notificationHelpers) {
        const { data, error } = await notificationHelpers.toggleNotification(id, enabled);
        if (error) throw error;
        const updated = notifications.map(n => n.id === id ? data : n);
        setNotifications(updated);
        if (onNotificationsChange) onNotificationsChange(updated);
      } else {
        const updatedNotifications = notifications.map(n => n.id === id ? { ...n, enabled } : n);
        setNotifications(updatedNotifications);
        if (onNotificationsChange) onNotificationsChange(updatedNotifications);
        await cacheService.set('notifications', updatedNotifications, CACHE_TTL_SECONDS);
      }
    } catch (error) {
      console.error('Toggle notification error:', error);
      alert('Ошибка изменения статуса');
    }
  };

  const editNotification = (notification) => {
    if (tg) tg.HapticFeedback?.impactOccurred('light');
    setEditingId(notification.id);

    const rawTime = notification.notification_time || notification.notificationTime || getCurrentLocalTime();
    const rawDays = notification.repeat_days || notification.repeatDays || [0, 1, 2, 3, 4, 5, 6];

    // Переводим UTC обратно в локальное время для отображения
    const localTime = utcTimeToLocal(rawTime);
    const dayShift  = getDayShift(localTime);
    const localDays = shiftDays(rawDays, -dayShift);

    setFormData({
      activityType: notification.activity_type || notification.activityType,
      notificationType: notification.notification_type || notification.notificationType,
      enabled: notification.enabled,
      notificationTime: localTime,
      repeatDays: localDays,
      intervalMinutes: notification.interval_minutes || notification.intervalMinutes || 180,
      title: notification.title || '',
      message: notification.message || '',
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(getDefaultFormData());
  };

  const toggleDay = (day) => {
    setFormData(prev => ({
      ...prev,
      repeatDays: prev.repeatDays.includes(day)
        ? prev.repeatDays.filter(d => d !== day)
        : [...prev.repeatDays, day].sort((a, b) => a - b)
    }));
  };

  const formatNotificationDescription = (notification) => {
    const activityLabel = activityTypes[notification.activity_type || notification.activityType]?.label || 'Активность';
    
    if ((notification.notification_type || notification.notificationType) === 'time') {
      const rawTime = notification.notification_time || notification.notificationTime;
      const time = utcTimeToLocal(rawTime); // UTC → локальное время для отображения
      const rawDays = notification.repeat_days || notification.repeatDays || [];
      const dayShift = getDayShift(time);
      const days = shiftDays(rawDays, -dayShift); // UTC-дни → локальные дни
      
      let daysText = '';
      if (days.length === 7) {
        daysText = 'Каждый день';
      } else if (days.length === 5 && !days.includes(0) && !days.includes(6)) {
        daysText = 'По будням';
      } else if (days.length === 2 && days.includes(0) && days.includes(6)) {
        daysText = 'По выходным';
      } else {
        daysText = days.map(d => daysOfWeek.find(day => day.value === d)?.label).join(', ');
      }
      
      return `${activityLabel} в ${time} • ${daysText}`;
    } else {
      const interval = notification.interval_minutes || notification.intervalMinutes;
      const hours = Math.floor(interval / 60);
      const minutes = interval % 60;
      let intervalText = '';
      if (hours > 0) {
        intervalText = `${hours}ч`;
        if (minutes > 0) intervalText += ` ${minutes}м`;
      } else {
        intervalText = `${minutes}м`;
      }
      
      return `${activityLabel} через ${intervalText} после последней`;
    }
  };

  if (showForm) {
    const ActivityIcon = activityTypes[formData.activityType]?.icon;
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
        {/* Отступ для Telegram заголовка */}
        <div className="h-16" />
        
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center mb-6">
              <button 
                onClick={resetForm} 
                className="mr-3 p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Bell className="w-6 h-6 mr-2" />
              <h2 className="text-xl font-semibold">
                {editingId ? 'Изменить уведомление' : 'Новое уведомление'}
              </h2>
            </div>

            <div className="space-y-6">
              {/* Activity Type */}
              <div>
                <label className="block mb-2 font-medium">Тип активности:</label>
                <select 
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  value={formData.activityType}
                  onChange={(e) => setFormData(prev => ({ ...prev, activityType: e.target.value }))}
                >
                  {Object.entries(activityTypes).map(([key, data]) => (
                    <option key={key} value={key}>{data.label}</option>
                  ))}
                </select>
              </div>

              {/* Notification Type */}
              <div>
                <label className="block mb-2 font-medium">Тип уведомления:</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setFormData(prev => ({ ...prev, notificationType: 'time' }))}
                    className={`p-4 rounded-lg border-2 flex flex-col items-center ${
                      formData.notificationType === 'time' 
                        ? 'border-purple-500 bg-purple-50' 
                        : 'border-gray-200'
                    }`}
                  >
                    <Clock className="w-6 h-6 mb-2" />
                    <span className="font-medium">По времени</span>
                    <span className="text-xs text-gray-500 mt-1">В определенное время</span>
                  </button>
                  <button
                    onClick={() => setFormData(prev => ({ ...prev, notificationType: 'interval' }))}
                    className={`p-4 rounded-lg border-2 flex flex-col items-center ${
                      formData.notificationType === 'interval' 
                        ? 'border-purple-500 bg-purple-50' 
                        : 'border-gray-200'
                    }`}
                  >
                    <RefreshCw className="w-6 h-6 mb-2" />
                    <span className="font-medium">По интервалу</span>
                    <span className="text-xs text-gray-500 mt-1">После последней активности</span>
                  </button>
                </div>
              </div>

              {/* Time-based settings */}
              {formData.notificationType === 'time' && (
                <>
                  <div>
                    <label className="block mb-2 font-medium">Время:</label>
                    <input
                      type="time"
                      className="w-full border-2 border-gray-200 rounded-lg p-3"
                      value={formData.notificationTime}
                      onChange={(e) => setFormData(prev => ({ ...prev, notificationTime: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block mb-3 font-medium">Дни недели:</label>
                    <div className="flex gap-2 justify-between">
                      {daysOfWeek.map(day => (
                        <button
                          key={day.value}
                          onClick={() => toggleDay(day.value)}
                          className={`w-12 h-12 rounded-lg border-2 font-medium ${
                            formData.repeatDays.includes(day.value)
                              ? 'border-purple-500 bg-purple-500 text-white'
                              : 'border-gray-200 text-gray-600'
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Interval-based settings */}
              {formData.notificationType === 'interval' && (
                <div>
                  <label className="block mb-2 font-medium">
                    Интервал (минут после последней активности):
                  </label>
                  <input
                    type="number"
                    className="w-full border-2 border-gray-200 rounded-lg p-3"
                    value={formData.intervalMinutes}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      intervalMinutes: parseInt(e.target.value) || 0 
                    }))}
                    placeholder="180"
                    min="1"
                  />
                  <div className="mt-2 text-sm text-gray-500">
                    {formData.intervalMinutes >= 60 
                      ? `${Math.floor(formData.intervalMinutes / 60)}ч ${formData.intervalMinutes % 60}м`
                      : `${formData.intervalMinutes}м`}
                  </div>
                </div>
              )}

              {/* Optional fields */}
              <div>
                <label className="block mb-2 font-medium">Заголовок (необязательно):</label>
                <input
                  type="text"
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Пользовательский заголовок"
                />
              </div>

              <div>
                <label className="block mb-2 font-medium">Сообщение (необязательно):</label>
                <textarea
                  className="w-full border-2 border-gray-200 rounded-lg p-3"
                  rows="3"
                  value={formData.message}
                  onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                  placeholder="Пользовательское сообщение"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={resetForm}
                  disabled={isSaving}
                  className={`flex-1 bg-gray-500 text-white py-3 rounded-lg font-medium transition-all ${
                    isSaving ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
                  }`}
                >
                  Отмена
                </button>
                <button
                  onClick={saveNotification}
                  disabled={isSaving}
                  className={`flex-1 bg-purple-600 text-white py-3 rounded-lg font-medium transition-all ${
                    isSaving ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
                  }`}
                >
                  {isSaving ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Сохранение...
                    </span>
                  ) : (
                    editingId ? 'Сохранить' : 'Создать'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 pb-24">
      {/* Отступ для Telegram заголовка */}
      <div className="h-16" />
      
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 bg-white rounded-2xl shadow-lg p-4">
          <div className="flex items-center">
            {showBackButton && (
              <button 
                onClick={onBack} 
                className="mr-3 p-2 hover:bg-gray-100 rounded-lg active:bg-gray-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <Bell className="w-6 h-6 mr-2 text-purple-600" />
            <h2 className="text-xl font-semibold">Уведомления</h2>
          </div>
          <button
            onClick={() => {
              if (tg) tg.HapticFeedback?.impactOccurred('light');
              setFormData(getDefaultFormData());
              setShowForm(true);
            }}
            className="bg-purple-500 text-white p-3 rounded-lg active:scale-95 transition-transform"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Info card */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 mb-4">
          <div className="flex items-start">
            <Bell className="w-5 h-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-medium mb-1">
                {isAndroid ? 'Уведомления приходят как push-сообщения' : 'Уведомления приходят в Telegram бот'}
              </p>
              {isAndroid ? (
                <p className="text-blue-700">
                  Настройте напоминания по времени или интервалам после активности.
                  Приложение отправит push-уведомление на ваше устройство.
                </p>
              ) : (
                <p className="text-blue-700">
                  Настройте напоминания по времени или интервалам после активности. 
                  Бот отправит сообщение в ваш чат.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Notifications list */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="text-lg font-semibold mb-4">
            Активные уведомления ({notifications.filter(n => n.enabled).length})
          </h3>
          
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Загрузка уведомлений...</p>
            </div>
          ) : notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map(notification => {
                const ActivityIcon = activityTypes[notification.activity_type || notification.activityType]?.icon;
                const activityColor = activityTypes[notification.activity_type || notification.activityType]?.color || 'bg-gray-100 text-gray-600';
                
                return (
                  <div 
                    key={notification.id} 
                    className={`rounded-lg p-4 ${notification.enabled ? activityColor : 'bg-gray-100 opacity-50'}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start flex-1 min-w-0">
                        {ActivityIcon && <ActivityIcon className="w-5 h-5 mr-3 mt-1 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium mb-1">
                            {formatNotificationDescription(notification)}
                          </div>
                          {(notification.title || notification.message) && (
                            <div className="text-sm opacity-75 mt-2">
                              {notification.title && <div className="font-medium">{notification.title}</div>}
                              {notification.message && <div>{notification.message}</div>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-2">
                        <button
                          onClick={() => toggleNotification(notification.id, !notification.enabled)}
                          className={`px-3 py-1 rounded-lg text-sm font-medium ${
                            notification.enabled 
                              ? 'bg-white/50 hover:bg-white/70' 
                              : 'bg-gray-300 hover:bg-gray-400'
                          }`}
                        >
                          {notification.enabled ? 'Вкл' : 'Выкл'}
                        </button>
                        <button
                          onClick={() => editNotification(notification)}
                          className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteNotification(notification.id)}
                          className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Нет настроенных уведомлений</p>
              <button
                onClick={() => {
                  if (tg) tg.HapticFeedback?.impactOccurred('light');
                  setShowForm(true);
                }}
                className="mt-4 bg-purple-500 text-white px-6 py-2 rounded-lg active:scale-95 transition-transform"
              >
                Создать первое уведомление
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsView;
