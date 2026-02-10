// notification-server.js
// Серверный код для отправки уведомлений через Telegram Bot
// Развертывание: Vercel, Railway, Heroku, или ваш VPS

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

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
        
        if (!telegramId) {
          console.log(`No Telegram ID for user ${notification.user_id}`);
          continue;
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
            await sendTelegramMessage(telegramId, notificationMessage, notification.title);
            sentNotifications.set(notificationKey, true);

            // Очистить старые записи (старше 2 часов)
            cleanupSentNotifications();

            console.log(`Notification sent to user ${telegramId}`);
          } else {
            console.log(`Notification already sent: ${notificationKey}`);
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
      .single();
    
    if (!baby) {
      return { shouldSend: false };
    }
    
    // Получить последнюю активность этого типа
    const { data: lastActivity } = await supabase
      .from('activities')
      .select('*')
      .eq('baby_id', baby.id)
      // В таблице activities тип активности хранится в колонке `type`.
      // Из-за фильтра по несуществующей `activity_type` lastActivity всегда был null,
      // и interval-уведомления никогда не отправлялись.
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

async function sendTelegramMessage(chatId, message, title = null) {
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
    
    return data;
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
    // Ключ формат: "notificationId-2026-01-31T07:30"
    // Берём всё после первого "-" как timestamp
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
    activeNotifications: sentNotifications.size
  });
});

// Cron endpoint для Vercel Cron Jobs
// Настройте в Vercel Dashboard: Settings → Cron Jobs → добавьте "0 * * * * *" (каждую минуту) на путь /api/cron
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
  console.log(`Notification service running on port ${PORT}`);
  console.log('Cron job scheduled to run every minute');
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
