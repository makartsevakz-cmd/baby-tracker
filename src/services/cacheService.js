// src/services/cacheService.js
import { Platform } from '../utils/platform';

/**
 * Универсальный сервис кеширования для Telegram и Android
 */
class CacheService {
  constructor() {
    this.platform = Platform.getCurrentPlatform();
    this.prefix = 'cache_';
    this.metaPrefix = 'cache_meta_';
    this.isReady = false;
    this.initPromise = this._init();
  }

  async _init() {
    // Для Android импортируем Preferences динамически
    if (this.platform === 'android') {
      try {
        const { Preferences } = await import('@capacitor/preferences');
        this.Preferences = Preferences;
      } catch (error) {
        console.warn('Capacitor Preferences not available, falling back to localStorage');
        this.platform = 'web';
      }
    }
    this.isReady = true;
  }

  async _ensureReady() {
    if (!this.isReady) {
      await this.initPromise;
    }
  }

  /**
   * Получить данные из кеша
   */
  async get(key) {
    await this._ensureReady();
    
    try {
      const fullKey = this.prefix + key;
      const metaKey = this.metaPrefix + key;

      const [dataStr, metaStr] = await Promise.all([
        this._getItem(fullKey),
        this._getItem(metaKey)
      ]);

      if (!dataStr) {
        return null;
      }

      // Проверяем срок действия
      if (metaStr) {
        const meta = JSON.parse(metaStr);
        const now = Date.now();

        if (meta.expiresAt && now > meta.expiresAt) {
          await this.remove(key);
          return null;
        }
      }

      return JSON.parse(dataStr);
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Сохранить данные в кеш
   */
  async set(key, data, ttl = 3600) {
    await this._ensureReady();
    
    try {
      const fullKey = this.prefix + key;
      const metaKey = this.metaPrefix + key;

      const dataStr = JSON.stringify(data);
      const meta = {
        createdAt: Date.now(),
        expiresAt: ttl ? Date.now() + (ttl * 1000) : null,
        size: dataStr.length
      };

      await Promise.all([
        this._setItem(fullKey, dataStr),
        this._setItem(metaKey, JSON.stringify(meta))
      ]);

      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Удалить из кеша
   */
  async remove(key) {
    await this._ensureReady();
    
    try {
      const fullKey = this.prefix + key;
      const metaKey = this.metaPrefix + key;

      await Promise.all([
        this._removeItem(fullKey),
        this._removeItem(metaKey)
      ]);

      return true;
    } catch (error) {
      console.error('Cache remove error:', error);
      return false;
    }
  }

  /**
   * Очистить весь кеш
   */
  async clear() {
    await this._ensureReady();
    
    try {
      const keys = await this._getAllKeys();
      
      const cacheKeys = keys.filter(k => 
        k.startsWith(this.prefix) || k.startsWith(this.metaPrefix)
      );

      await Promise.all(
        cacheKeys.map(key => this._removeItem(key))
      );

      console.log(`🗑️ Cleared ${cacheKeys.length} cache entries`);
      return true;
    } catch (error) {
      console.error('Cache clear error:', error);
      return false;
    }
  }

  /**
   * Получить статистику кеша
   */
  async getStats() {
    await this._ensureReady();
    
    try {
      const keys = await this._getAllKeys();
      const cacheKeys = keys.filter(k => 
        k.startsWith(this.prefix) && !k.startsWith(this.metaPrefix)
      );

      let totalSize = 0;
      let validCount = 0;
      let expiredCount = 0;

      for (const key of cacheKeys) {
        const metaKey = key.replace(this.prefix, this.metaPrefix);
        const metaStr = await this._getItem(metaKey);

        if (metaStr) {
          const meta = JSON.parse(metaStr);
          totalSize += meta.size;

          const now = Date.now();
          if (meta.expiresAt && now > meta.expiresAt) {
            expiredCount++;
          } else {
            validCount++;
          }
        }
      }

      return {
        platform: this.platform,
        totalKeys: cacheKeys.length,
        validKeys: validCount,
        expiredKeys: expiredCount,
        totalSize: totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return null;
    }
  }

  /**
   * Очистить истёкший кеш
   */
  async cleanExpired() {
    await this._ensureReady();
    
    try {
      const keys = await this._getAllKeys();
      const cacheKeys = keys.filter(k => 
        k.startsWith(this.prefix) && !k.startsWith(this.metaPrefix)
      );

      let cleaned = 0;
      const now = Date.now();

      for (const fullKey of cacheKeys) {
        const key = fullKey.replace(this.prefix, '');
        const metaKey = this.metaPrefix + key;
        const metaStr = await this._getItem(metaKey);

        if (metaStr) {
          const meta = JSON.parse(metaStr);
          if (meta.expiresAt && now > meta.expiresAt) {
            await this.remove(key);
            cleaned++;
          }
        }
      }

      console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
      return cleaned;
    } catch (error) {
      console.error('Cache clean error:', error);
      return 0;
    }
  }

  // ============================================
  // Внутренние методы (платформо-специфичные)
  // ============================================

  async _getItem(key) {
    if (this.platform === 'telegram' || this.platform === 'web') {
      return localStorage.getItem(key);
    } else if (this.platform === 'android' && this.Preferences) {
      const { value } = await this.Preferences.get({ key });
      return value;
    }
    return null;
  }

  async _setItem(key, value) {
    if (this.platform === 'telegram' || this.platform === 'web') {
      localStorage.setItem(key, value);
    } else if (this.platform === 'android' && this.Preferences) {
      await this.Preferences.set({ key, value });
    }
  }

  async _removeItem(key) {
    if (this.platform === 'telegram' || this.platform === 'web') {
      localStorage.removeItem(key);
    } else if (this.platform === 'android' && this.Preferences) {
      await this.Preferences.remove({ key });
    }
  }

  async _getAllKeys() {
    if (this.platform === 'telegram' || this.platform === 'web') {
      return Object.keys(localStorage);
    } else if (this.platform === 'android' && this.Preferences) {
      const { keys } = await this.Preferences.keys();
      return keys;
    }
    return [];
  }
}

export default new CacheService();