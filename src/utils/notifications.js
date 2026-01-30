// src/utils/notifications.js
import { supabase } from './supabase.js';

export const notificationHelpers = {
  async getNotifications() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: [], error: null };

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    
    return { data, error };
  },

  async createNotification(notification) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: 'Not authenticated' };

    const notificationData = {
      user_id: user.id,
      activity_type: notification.activityType,
      notification_type: notification.notificationType, // 'time' or 'interval'
      enabled: notification.enabled !== undefined ? notification.enabled : true,
      
      // For time-based notifications
      notification_time: notification.notificationTime,
      repeat_days: notification.repeatDays, // [0,1,2,3,4,5,6] for days of week
      
      // For interval-based notifications
      interval_minutes: notification.intervalMinutes,
      
      // Optional
      title: notification.title,
      message: notification.message,
    };

    const { data, error } = await supabase
      .from('notifications')
      .insert([notificationData])
      .select()
      .single();
    
    return { data, error };
  },

  async updateNotification(id, notification) {
    const updateData = {
      activity_type: notification.activityType,
      notification_type: notification.notificationType,
      enabled: notification.enabled,
      notification_time: notification.notificationTime,
      repeat_days: notification.repeatDays,
      interval_minutes: notification.intervalMinutes,
      title: notification.title,
      message: notification.message,
    };

    const { data, error } = await supabase
      .from('notifications')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    return { data, error };
  },

  async deleteNotification(id) {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id);
    
    return { error };
  },

  async toggleNotification(id, enabled) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ enabled })
      .eq('id', id)
      .select()
      .single();
    
    return { data, error };
  },
};

// Helper function to send notification via Telegram bot
export const sendTelegramNotification = async (chatId, message, botToken) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    const data = await response.json();
    return { success: data.ok, data };
  } catch (error) {
    console.error('Failed to send Telegram notification:', error);
    return { success: false, error };
  }
};

// Helper to check if notification should be sent based on time
export const shouldSendTimeNotification = (notification, now = new Date()) => {
  if (!notification.enabled || notification.notification_type !== 'time') {
    return false;
  }

  // Check day of week
  const dayOfWeek = now.getDay();
  if (!notification.repeat_days || !notification.repeat_days.includes(dayOfWeek)) {
    return false;
  }

  // Check time (within 1 minute window)
  if (!notification.notification_time) return false;
  
  const [hours, minutes] = notification.notification_time.split(':').map(Number);
  const notificationTime = new Date(now);
  notificationTime.setHours(hours, minutes, 0, 0);
  
  const diff = Math.abs(now - notificationTime);
  return diff < 60000; // Within 1 minute
};

// Helper to check if interval notification should be sent
export const shouldSendIntervalNotification = (notification, lastActivity, now = new Date()) => {
  if (!notification.enabled || notification.notification_type !== 'interval') {
    return false;
  }

  if (!lastActivity || !notification.interval_minutes) {
    return false;
  }

  const lastTime = new Date(lastActivity.endTime || lastActivity.startTime);
  const diffMinutes = (now - lastTime) / (1000 * 60);
  
  // Send notification if interval has passed (with 1 minute tolerance)
  return diffMinutes >= notification.interval_minutes - 1;
};
