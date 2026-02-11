// src/services/notificationService.js
import { Platform } from '../utils/platform';
import * as supabaseModule from '../utils/supabase';

class NotificationService {
  constructor() {
    this.platform = Platform.getCurrentPlatform();
    this.initialized = false;
    this.fcmToken = null;
  }

  async initialize() {
    if (this.initialized) {
      console.log('⚠️ Notifications already initialized');
      return;
    }

    console.log(`🔔 Initializing notifications for ${this.platform}`);

    if (this.platform === 'telegram') {
      // Telegram - уведомления через бота, ничего не нужно
      console.log('📱 Telegram notifications ready (via bot)');
      this.initialized = true;
      return;
    }

    if (this.platform === 'android') {
      await this.initializeAndroidNotifications();
      this.initialized = true;
    }
  }

  async initializeAndroidNotifications() {
    try {
      console.log('📱 Starting Android notification setup...');
      
      // ИСПРАВЛЕНО: Статический импорт вместо динамического
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const { LocalNotifications } = await import('@capacitor/local-notifications');

      console.log('✅ Capacitor plugins loaded');

      // Запрашиваем разрешения
      console.log('🔐 Requesting permissions...');
      const permResult = await PushNotifications.requestPermissions();
      console.log('🔐 Permission result:', permResult);
      
      if (permResult.receive !== 'granted') {
        console.warn('⚠️ Push notification permission denied');
        return;
      }

      // Регистрируем устройство
      console.log('📝 Registering for push notifications...');
      await PushNotifications.register();

      // Слушаем токен
      PushNotifications.addListener('registration', async (token) => {
        console.log('✅ FCM Token received:', token.value);
        this.fcmToken = token.value;

        // Сохраняем токен в Supabase
        await this.saveFCMToken(token.value);
      });

      // Слушаем ошибки регистрации
      PushNotifications.addListener('registrationError', (error) => {
        console.error('❌ FCM registration error:', error);
      });

      // Обработка уведомлений когда приложение открыто
      PushNotifications.addListener('pushNotificationReceived', async (notification) => {
        console.log('📬 Push notification received (foreground):', notification);

        // Показываем локальное уведомление
        try {
          await LocalNotifications.schedule({
            notifications: [{
              title: notification.title || 'Дневник малыша',
              body: notification.body || '',
              id: Date.now(),
              schedule: { at: new Date(Date.now() + 100) },
              sound: 'default',
              smallIcon: 'ic_stat_icon_config_sample',
              iconColor: '#9333EA'
            }]
          });
          console.log('✅ Local notification scheduled');
        } catch (err) {
          console.error('❌ Failed to schedule local notification:', err);
        }
      });

      // Обработка нажатия на уведомление
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('👆 Notification action performed:', notification);
        // Здесь можно добавить навигацию к конкретному экрану
      });

      console.log('✅ Android push notifications initialized successfully');
    } catch (error) {
      console.error('💥 Android notification init error:', error);
      console.error('Error details:', error.message, error.stack);
    }
  }

  async saveFCMToken(token) {
    try {
      console.log('💾 Saving FCM token to Supabase...');
      
      const user = await supabaseModule.authHelpers.getCurrentUser();
      if (!user) {
        console.warn('⚠️ No user to save FCM token for');
        return;
      }

      console.log('👤 User ID:', user.id);

      const { data, error } = await supabaseModule.supabase
        .from('device_tokens')
        .upsert({
          user_id: user.id,
          token: token,
          platform: 'android',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,token'
        })
        .select();

      if (error) {
        console.error('❌ Failed to save FCM token:', error);
        throw error;
      }

      console.log('✅ FCM token saved to Supabase:', data);
    } catch (error) {
      console.error('💥 Save FCM token error:', error);
    }
  }

  async requestPermissions() {
    if (this.platform === 'android') {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        return await PushNotifications.requestPermissions();
      } catch (error) {
        console.error('Failed to request permissions:', error);
        return { receive: 'denied' };
      }
    }
    return { receive: 'granted' };
  }

  // Отправить тестовое уведомление (для отладки)
  async sendTestNotification() {
    if (this.platform !== 'android') {
      console.warn('⚠️ Test notifications only available on Android');
      return;
    }

    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      
      await LocalNotifications.schedule({
        notifications: [{
          title: 'Тестовое уведомление',
          body: 'Если вы видите это - уведомления работают! 🎉',
          id: Date.now(),
          schedule: { at: new Date(Date.now() + 1000) },
          sound: 'default',
          smallIcon: 'ic_stat_icon_config_sample',
          iconColor: '#9333EA'
        }]
      });

      console.log('✅ Test notification sent');
    } catch (error) {
      console.error('❌ Failed to send test notification:', error);
    }
  }
}

export default new NotificationService();