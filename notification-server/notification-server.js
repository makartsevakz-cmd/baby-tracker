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
cron.schedule('* * * * *', async () => {
  console.log('Checking notifications at', new Date().toISOString());
  await checkAndSendNotifications();
});

async function checkAndSendNotifications() {
  try {
    // Получить все активные уведомления с информацией о пользователях
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select(`
        *,
        users:user_id (
          id,
          raw_user_meta_data
        )
      `)
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
    
    const now = new Date();
    
    for (const notification of notifications) {
      try {
        // Получить Telegram ID пользователя
        const telegramId = notification.users?.raw_user_meta_data?.telegram_id;
        
        if (!telegramId) {
          console.log(`No Telegram ID for user ${notification.user_id}`);
          continue;
        }
        
        let shouldSend = false;
        let notificationMessage = '';
        
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
          if (shouldSend) {
            notificationMessage = notification.message || 
              `⏰ Прошло ${formatInterval(notification.interval_minutes)} с последней активности: ${getActivityLabel(notification.activity_type)}`;
          }
        }
        
        // Отправить уведомление если нужно
        if (shouldSend) {
          // Проверить, не отправляли ли мы это уведомление недавно
          const notificationKey = `${notification.id}-${now.toISOString().slice(0, 16)}`;
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
      .eq('type', notification.activity_type)
      .order('start_time', { ascending: false })
      .limit(1)
      .single();
    
    if (!lastActivity) {
      return { shouldSend: false };
    }
    
    const lastTime = new Date(lastActivity.end_time || lastActivity.start_time);
    const diffMinutes = (now - lastTime) / (1000 * 60);
    
    // Отправить если прошел интервал (с учетом погрешности в 1 минуту)
    const shouldSend = diffMinutes >= notification.interval_minutes - 1 && 
                       diffMinutes <= notification.interval_minutes + 1;
    
    return { shouldSend };
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
    medicine: 'Лекарство'
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
    // Извлечь timestamp из ключа
    const timestamp = key.split('-').slice(-5).join('-'); // последние 5 частей это timestamp
    const keyTime = new Date(timestamp).getTime();
    
    if (keyTime < twoHoursAgo) {
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
app.listen(PORT, () => {
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
