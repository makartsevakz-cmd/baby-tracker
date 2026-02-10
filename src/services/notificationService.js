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
    if (this.initialized) return;

    console.log(`🔔 Initializing notifications for ${this.platform}`);

    if (this.platform === 'telegram') {
      // Telegram - уведомления через бота, ничего не нужно
      console.log('📱 Telegram notifications ready (via bot)');
      this.initialized = true;
      return;
    }

    if (this.platform === 'android') {
      await this.initializeAndroidNotifications();
    }

    this.initialized = true;
  }

  async initializeAndroidNotifications() {
    try {
      // Динамический импорт Capacitor плагинов
      const pushNotificationsModuleName = '@capacitor/push-notifications';
      const localNotificationsModuleName = '@capacitor/local-notifications';
      const { PushNotifications } = await import(/* @vite-ignore */ pushNotificationsModuleName);
      const { LocalNotifications } = await import(/* @vite-ignore */ localNotificationsModuleName);

      // Запрашиваем разрешения
      const permResult = await PushNotifications.requestPermissions();
      
      if (permResult.receive !== 'granted') {
        console.warn('⚠️ Push notification permission denied');
        return;
      }

      // Регистрируем устройство
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
        console.log('🔔 Push notification received:', notification);

        // Показываем локальное уведомление
        await LocalNotifications.schedule({
          notifications: [{
            title: notification.title || 'Baby Tracker',
            body: notification.body || '',
            id: Date.now(),
            schedule: { at: new Date(Date.now() + 100) },
            sound: 'default',
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#9333EA'
          }]
        });
      });

      // Обработка нажатия на уведомление
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('🔔 Notification action:', notification);
        // Здесь можно добавить навигацию к конкретному экрану
      });

      console.log('✅ Android push notifications initialized');
    } catch (error) {
      console.error('Android notification init error:', error);
    }
  }

  async saveFCMToken(token) {
    try {
      const user = await supabaseModule.authHelpers.getCurrentUser();
      if (!user) {
        console.warn('No user to save FCM token for');
        return;
      }

      const { error } = await supabaseModule.supabase
        .from('device_tokens')
        .upsert({
          user_id: user.id,
          token: token,
          platform: 'android',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,token'
        });

      if (error) {
        console.error('Failed to save FCM token:', error);
      } else {
        console.log('✅ FCM token saved to Supabase');
      }
    } catch (error) {
      console.error('Save FCM token error:', error);
    }
  }

  async requestPermissions() {
    if (this.platform === 'android') {
      const pushNotificationsModuleName = '@capacitor/push-notifications';
      const { PushNotifications } = await import(/* @vite-ignore */ pushNotificationsModuleName);
      return await PushNotifications.requestPermissions();
    }
    return { receive: 'granted' };
  }
}

export default new NotificationService();