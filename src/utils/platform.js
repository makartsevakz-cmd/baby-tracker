// src/utils/platform.js
/**
 * Определение текущей платформы (Telegram, Android, Web)
 */
export const Platform = {
  isTelegram: () => {
    return typeof window !== 'undefined' && window.Telegram?.WebApp !== undefined;
  },
  
  isAndroid: () => {
    return typeof window !== 'undefined' && window.Capacitor?.getPlatform() === 'android';
  },
  
  isWeb: () => {
    return !Platform.isTelegram() && !Platform.isAndroid();
  },
  
  getCurrentPlatform: () => {
    if (Platform.isTelegram()) return 'telegram';
    if (Platform.isAndroid()) return 'android';
    return 'web';
  },

  // Проверка доступности сети
  isOnline: () => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }
};

// Мок Capacitor для браузерного тестирования
export const mockCapacitor = () => {
  if (typeof window === 'undefined' || window.Capacitor) return;
  
  console.log('🔧 Initializing Capacitor mock for browser testing');
  
  window.Capacitor = {
    getPlatform: () => 'android',
    isNativePlatform: () => false,
    Plugins: {}
  };
  
  // Мок Preferences
  const storage = {};
  window.Capacitor.Plugins.Preferences = {
    get: async ({ key }) => ({ value: storage[key] || null }),
    set: async ({ key, value }) => { storage[key] = value; },
    remove: async ({ key }) => { delete storage[key]; },
    keys: async () => ({ keys: Object.keys(storage) })
  };
  
  // Мок Push Notifications
  window.Capacitor.Plugins.PushNotifications = {
    requestPermissions: async () => ({ receive: 'granted' }),
    register: async () => {
      console.log('📱 Mock: Push notifications registered');
    },
    addListener: (event, callback) => {
      console.log(`🔔 Mock listener added: ${event}`);
      if (event === 'registration') {
        setTimeout(() => {
          callback({ value: 'mock_fcm_token_' + Date.now() });
        }, 1000);
      }
      return { remove: () => {} };
    }
  };
  
  // Мок Local Notifications
  window.Capacitor.Plugins.LocalNotifications = {
    schedule: async (options) => {
      console.log('🔔 Mock local notification:', options.notifications[0]);
    }
  };
  
  // Мок Network
  window.Capacitor.Plugins.Network = {
    getStatus: async () => ({ connected: true, connectionType: 'wifi' }),
    addListener: (event, callback) => {
      console.log(`📡 Mock network listener: ${event}`);
      return { remove: () => {} };
    }
  };
};