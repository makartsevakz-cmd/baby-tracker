// notification-server.js
// Серверный код для отправки уведомлений через Telegram Bot и Android FCM
// Развертывание: Vercel, Railway, Heroku, или ваш VPS

import dotenv from 'dotenv';
import admin from 'firebase-admin';
import express from 'express';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

dotenv.config();

const app = express();
app.use(express.json());

// Инициализация Firebase Admin SDK
let firebaseInitialized = false;
try {
  const serviceAccount = process.env.FIREBASE_ADMIN_KEY_BASE64
  ? JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_KEY_BASE64, 'base64').toString('utf8'))
  : JSON.parse(readFileSync('./firebase-admin-key.json', 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  firebaseInitialized = true;
  console.log('✅ Firebase Admin SDK initialized');
  console.log(`📦 Project ID: ${serviceAccount.project_id}`);
} catch (error) {
  console.warn('⚠️ Firebase Admin SDK not initialized:', error.message);
  console.warn('Android push notifications will not work');
}

// Инициализация Supabase с service key (не anon key!)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Хранилище последних отправленных уведомлений (чтобы не спамить)
const sentNotifications = new Map();

// Проверка уведомлений каждую минуту
// ⚠️ node-cron работает только на постоянно запущенных серверах (Railway, Heroku, VPS)
// На Vercel используйте endpoint GET /api/cron + Vercel Cron Jobs
cron.schedule('* * * * *', async () => {
  console.log('Checking notifications at', new Date().toISOString());
  await checkAndSendNotifications();
});

async function checkAndSendNotifications() {
  try {
    // Получить все активные уведомления
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('enabled', true);
    
    if (error) {
      console.error('Error fetching notifications:', error);
      return;
    }
    
    if (!notifications || notifications.length === 0) {
      console.log('No active notifications found');
      return;
    }
    
    console.log(`Found ${notifications.length} active notifications`);
    
    // Кэш: telegram_id по user_id (чтобы не делать запрос для каждого уведомления)
    const telegramIdCache = {};
    
    const now = new Date();
    
    for (const notification of notifications) {
      try {
        // Получить Telegram ID пользователя (с кэшем)
        let telegramId = telegramIdCache[notification.user_id];
        if (!telegramId) {
          const { data: user } = await supabase.auth.admin.getUserById(notification.user_id);
          telegramId = user?.user_metadata?.telegram_id;
          if (telegramId) {
            telegramIdCache[notification.user_id] = telegramId;
          }
        }
        
        let shouldSend = false;
        let notificationMessage = '';
        let intervalWindow = null;
        
        // Проверить time-based уведомления
        if (notification.notification_type === 'time') {
          shouldSend = checkTimeNotification(notification, now);
          if (shouldSend) {
            notificationMessage = notification.message || 
              `⏰ Время для: ${getActivityLabel(notification.activity_type)}`;
          }
        }
        
        // Проверить interval-based уведомления
        if (notification.notification_type === 'interval') {
          const result = await checkIntervalNotification(notification, now);
          shouldSend = result.shouldSend;
          intervalWindow = result.intervalWindow ?? null;
          if (shouldSend) {
            notificationMessage = notification.message || 
              `⏰ Прошло ${formatInterval(notification.interval_minutes)} с последней активности: ${getActivityLabel(notification.activity_type)}`;
          }
        }
        
        // Отправить уведомление если нужно
        if (shouldSend) {
          // Для interval уведомлений дедуплицируем по окну интервала,
          // для time уведомлений — по минуте.
          const isInterval = notification.notification_type === 'interval';
          const notificationKey = isInterval
            ? `${notification.id}-interval-${intervalWindow ?? 0}`
            : `${notification.id}-time-${now.toISOString().slice(0, 16)}`;

          if (!sentNotifications.has(notificationKey)) {
            await sendNotification(notification.user_id, notification.title, notificationMessage);
            sentNotifications.set(notificationKey, true);

            // Очистить старые записи (старше 2 часов)
            cleanupSentNotifications();

            console.log(`✅ Notification sent for user ${notification.user_id}`);
          } else {
            console.log(`⏭️  Notification already sent: ${notificationKey}`);
          }
        }
      } catch (error) {
        console.error(`Error processing notification ${notification.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in checkAndSendNotifications:', error);
  }
}

function checkTimeNotification(notification, now) {
  // Проверить день недели
  const dayOfWeek = now.getDay();
  if (!notification.repeat_days || !notification.repeat_days.includes(dayOfWeek)) {
    return false;
  }
  
  // Проверить время (в пределах 1 минуты)
  if (!notification.notification_time) return false;
  
  const [hours, minutes] = notification.notification_time.split(':').map(Number);
  const notificationTime = new Date(now);
  notificationTime.setHours(hours, minutes, 0, 0);
  
  const diff = Math.abs(now - notificationTime);
  return diff < 60000; // В пределах 1 минуты
}

async function checkIntervalNotification(notification, now) {
  try {
    // Получить baby_id для этого пользователя
    const { data: baby } = await supabase
      .from('babies')
      .select('id')
      .eq('user_id', notification.user_id)
      .maybeSingle();
    
    if (!baby) {
      return { shouldSend: false };
    }
    
    // Получить последнюю активность этого типа
    const { data: lastActivity } = await supabase
      .from('activities')
      .select('*')
      .eq('baby_id', baby.id)
      .eq('type', notification.activity_type)
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (!lastActivity) {
      return { shouldSend: false };
    }

    const intervalMinutes = Number(notification.interval_minutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      return { shouldSend: false };
    }

    const lastTime = new Date(lastActivity.end_time || lastActivity.start_time);
    const diffMinutes = (now - lastTime) / (1000 * 60);

    // Отправить, когда интервал пройден. Номер окна интервала используем для дедупликации.
    const shouldSend = diffMinutes >= intervalMinutes;
    const intervalWindow = shouldSend ? Math.floor(diffMinutes / intervalMinutes) : null;

    return { shouldSend, intervalWindow };
  } catch (error) {
    console.error('Error checking interval notification:', error);
    return { shouldSend: false };
  }
}

async function sendNotification(userId, title, message) {
  try {
    // 🔥 ИСПРАВЛЕНО: Получаем данные пользователя через auth.admin
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
    
    if (authError || !authUser) {
      console.error('User not found:', userId, authError);
      return { success: false, error: 'User not found' };
    }

    // Получаем device tokens из таблицы
    const { data: deviceTokens } = await supabase
      .from('device_tokens')
      .select('*')
      .eq('user_id', userId);
    
    const results = { telegram: null, android: null };
    
    // Отправляем в Telegram если есть telegram_id в метаданных
    const telegramId = authUser.user_metadata?.telegram_id;
    if (telegramId) {
      try {
        const telegramResult = await sendTelegramMessage(telegramId, title, message);
        results.telegram = telegramResult;
        console.log(`📱 Telegram notification sent to ${telegramId}`);
      } catch (error) {
        console.error('Telegram send error:', error);
        results.telegram = { success: false, error: error.message };
      }
    }
    
    // Отправляем в Android если есть токены и Firebase настроен
    if (firebaseInitialized && deviceTokens && deviceTokens.length > 0) {
      const androidTokens = deviceTokens.filter(t => t.platform === 'android');
      
      if (androidTokens.length > 0) {
        console.log(`📱 Sending to ${androidTokens.length} Android device(s)...`);
        
        let successCount = 0;
        let failureCount = 0;
        const failedTokens = [];
        
        // Отправляем каждому токену отдельно (HTTP v1 API)
        for (const tokenObj of androidTokens) {
          try {
            const notificationMessage = {
              token: tokenObj.token,
              notification: {
                title: title || 'Дневник малыша',
                body: message
              },
              android: {
                priority: 'high',
                notification: {
                  sound: 'default',
                  channelId: 'default'
                }
              }
            };
            
            await admin.messaging().send(notificationMessage);
            console.log(`✅ Sent to token ${tokenObj.token.substring(0, 20)}...`);
            successCount++;
          } catch (error) {
            console.error(`❌ Failed to send to token ${tokenObj.token.substring(0, 20)}...: ${error.message}`);
            failureCount++;
            
            // Если токен невалидный - добавляем в список для удаления
            if (error.code === 'messaging/invalid-registration-token' || 
                error.code === 'messaging/registration-token-not-registered') {
              failedTokens.push(tokenObj.token);
            }
          }
        }
        
        console.log(`📊 Android results: ${successCount} success, ${failureCount} failed`);
        
        // Удаляем невалидные токены
        if (failedTokens.length > 0) {
          try {
            await supabase
              .from('device_tokens')
              .delete()
              .in('token', failedTokens);
            console.log(`🗑️  Removed ${failedTokens.length} invalid token(s)`);
          } catch (error) {
            console.error('Failed to remove invalid tokens:', error);
          }
        }
        
        results.android = {
          success: successCount > 0,
          successCount,
          failureCount
        };
      }
    }
    
    return {
      success: results.telegram?.success || results.android?.success || false,
      results
    };
  } catch (error) {
    console.error('Send notification error:', error);
    return { success: false, error: error.message };
  }
}

async function sendTelegramMessage(chatId, title, message) {
  try {
    const fullMessage = title ? `<b>${title}</b>\n\n${message}` : message;
    
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: fullMessage,
          parse_mode: 'HTML',
        }),
      }
    );
    
    const data = await response.json();
    
    if (!data.ok) {
      console.error('Telegram API error:', data);
      throw new Error(`Telegram API error: ${data.description}`);
    }
    
    return { success: true, data };
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    throw error;
  }
}

function getActivityLabel(type) {
  const labels = {
    breastfeeding: 'Кормление грудью',
    bottle: 'Бутылочка',
    sleep: 'Сон',
    bath: 'Купание',
    walk: 'Прогулка',
    diaper: 'Подгузник',
    medicine: 'Лекарство',
    activity: 'Активность',
    burp: 'Отрыжка'
  };
  return labels[type] || type;
}

function formatInterval(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return mins > 0 ? `${hours}ч ${mins}м` : `${hours}ч`;
  }
  return `${mins}м`;
}

function cleanupSentNotifications() {
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
  
  for (const [key] of sentNotifications) {
    const dashIndex = key.indexOf('-');
    if (dashIndex === -1) continue;
    
    const timestamp = key.substring(dashIndex + 1);
    const keyTime = new Date(timestamp).getTime();
    
    if (isNaN(keyTime) || keyTime < twoHoursAgo) {
      sentNotifications.delete(key);
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeNotifications: sentNotifications.size,
    firebaseInitialized
  });
});

// Cron endpoint для Vercel Cron Jobs
app.get('/api/cron', async (req, res) => {
  try {
    await checkAndSendNotifications();
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual trigger endpoint (для тестирования)
app.post('/trigger', async (req, res) => {
  try {
    await checkAndSendNotifications();
    res.json({ success: true, message: 'Notifications check triggered' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Notification service running on port ${PORT}`);
  console.log('📅 Cron job scheduled to run every minute');
  console.log(`🔥 Firebase: ${firebaseInitialized ? 'ENABLED' : 'DISABLED'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});