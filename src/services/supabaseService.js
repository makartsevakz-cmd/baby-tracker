// src/services/supabaseService.js
import * as supabaseModule from '../utils/supabase.js';
import cacheService, { CACHE_TTL_SECONDS } from './cacheService.js';

/**
 * Обёртка для Supabase с кешированием
 */
class SupabaseService {
  
  /**
   * Получить данные с кешированием
   */
  async getWithCache(table, options = {}, ttl = CACHE_TTL_SECONDS) {
    const cacheKey = this._generateCacheKey(table, options);

    // Пытаемся получить из кеша
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit: ${table}`);
      return { data: cached, error: null, fromCache: true };
    }

    console.log(`❌ Cache miss: ${table}, fetching from Supabase...`);

    // Запрашиваем из Supabase
    let query = supabaseModule.supabase.from(table).select(options.select || '*');

    // Применяем фильтры
    if (options.eq) {
      Object.entries(options.eq).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }

    if (options.order) {
      query = query.order(options.order.column, { 
        ascending: options.order.ascending !== false 
      });
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    // Если успешно — сохраняем в кеш
    if (!error && data) {
      await cacheService.set(cacheKey, data, ttl);
    }

    return { data, error, fromCache: false };
  }

  /**
   * Создать/обновить данные (инвалидация кеша)
   */
  async upsert(table, data, helpers) {
    const { data: result, error } = helpers
      ? await helpers.upsertProfile(data)
      : await supabaseModule.supabase
          .from(table)
          .upsert(data)
          .select();

    // Инвалидируем кеш для этой таблицы
    if (!error) {
      await this._invalidateTableCache(table);
    }

    return { data: result, error };
  }

  /**
   * Удалить данные (инвалидация кеша)
   */
  async delete(table, filters) {
    let query = supabaseModule.supabase.from(table).delete();

    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { error } = await query;

    if (!error) {
      await this._invalidateTableCache(table);
    }

    return { error };
  }

  /**
   * Генерация ключа кеша
   */
  _generateCacheKey(table, options) {
    const optionsStr = JSON.stringify(options);
    return `${table}_${this._hashString(optionsStr)}`;
  }

  /**
   * Простой хеш строки
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Инвалидация всего кеша таблицы (публичный метод)
   */
  async invalidateTableCache(table) {
    // Используем оптимизированный метод clearByPrefix
    const count = await cacheService.clearByPrefix(table);
    console.log(`🗑️ Invalidated ${count} cache entries for table: ${table}`);
    return count;
  }
  
  /**
   * Инвалидация всего кеша таблицы (приватный метод для обратной совместимости)
   */
  async _invalidateTableCache(table) {
    return this.invalidateTableCache(table);
  }
}

export default new SupabaseService();