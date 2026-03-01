import React, { useEffect, useMemo, useState } from 'react';
import supabaseService from '../../services/supabaseService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toDayKey = (dateLike) => {
  const date = new Date(dateLike);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDayLabel = (dayKey) => {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

const formatMinutes = (minutes) => {
  if (!minutes || minutes < 1) return '0 мин';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}ч ${m}м`;
  }
  return `${Math.round(minutes)} мин`;
};

const StatsCard = ({ title, children }) => (
  <div className="bg-white rounded-2xl shadow-lg p-4">
    <h3 className="text-sm font-semibold mb-3 text-gray-700">{title}</h3>
    {children}
  </div>
);

const WeekPickerCard = ({ selectedMonday, currentMonday, onWeekStartChange }) => {
  const moveWeek = (delta) => {
    const next = new Date(selectedMonday);
    next.setDate(next.getDate() + (delta * 7));
    const normalized = getMonday(next);
    if (normalized > currentMonday) return;
    onWeekStartChange?.(toDateInputValue(normalized));
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4">
      <div className="flex items-center justify-center gap-3">
        <button type="button" className="h-9 w-9 rounded-full border-2 border-purple-100 text-purple-500 hover:bg-purple-50" onClick={() => moveWeek(-1)}>
          ‹
        </button>
        <div className="min-w-[180px] text-center text-sm font-extrabold text-gray-700">{formatWeekLabel(selectedMonday)}</div>
        <button
          type="button"
          className="h-9 w-9 rounded-full border-2 border-purple-100 text-purple-500 hover:bg-purple-50 disabled:opacity-40"
          onClick={() => moveWeek(1)}
          disabled={selectedMonday >= currentMonday}
        >
          ›
        </button>
      </div>
    </div>
  );
};

const EmptyState = ({ text }) => (
  <div className="rounded-2xl border border-dashed border-purple-200 bg-purple-50 p-6 text-center text-sm text-purple-500">
    {text}
  </div>
);

const MetricPill = ({ label, value, color = 'bg-purple-50 text-purple-700' }) => (
  <div className={`rounded-xl px-3 py-2 ${color}`}>
    <div className="text-xs opacity-75">{label}</div>
    <div className="font-semibold">{value}</div>
  </div>
);

const FeedingSectionCard = ({ title, emoji, desc, tip, children }) => (
  <div className="rounded-2xl border border-orange-100 bg-white p-4 shadow-lg">
    <div className="mb-1 flex items-start justify-between gap-2">
      <h3 className="text-base font-extrabold text-gray-800">{title}</h3>
      <div className="text-xl leading-none">{emoji}</div>
    </div>
    <p className="mb-4 text-xs leading-relaxed text-gray-500">{desc}</p>
    {children}
    {tip ? (
      <div className="mt-3 flex gap-2 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2">
        <span className="text-sm">💡</span>
        <p className="text-[12px] leading-relaxed text-gray-600">{tip}</p>
      </div>
    ) : null}
  </div>
);

const SingleBarChart = ({ data, valueKey, color, unit }) => {
  const maxValue = Math.max(1, ...data.map((row) => row[valueKey] || 0));

  return (
    <div className="space-y-3">
      {data.map((row) => (
        <div key={row.day}>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{formatDayLabel(row.day)}</span>
            <span>{Math.round(row[valueKey] || 0)} {unit}</span>
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${((row[valueKey] || 0) / maxValue) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const SleepTimeline = ({ sessions }) => (
  <div>
    <div className="relative h-20 rounded-xl bg-indigo-50 border border-indigo-100 overflow-hidden">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="absolute h-10 top-5 rounded-lg bg-indigo-300"
          style={{ left: `${session.left}%`, width: `${session.width}%` }}
          title={`${session.startLabel}–${session.endLabel}`}
        />
      ))}
    </div>
    <div className="mt-2 flex justify-between text-xs text-gray-400">
      <span>00:00</span>
      <span>06:00</span>
      <span>12:00</span>
      <span>18:00</span>
      <span>24:00</span>
    </div>
  </div>
);


const getMonday = (dateLike = new Date()) => {
  const date = new Date(dateLike);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const mondayDateInputMin = '1970-01-05';

const toDateInputValue = (dateLike) => {
  const date = new Date(dateLike);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatInterval = (minutes) => {
  if (minutes === null || minutes === undefined) return '—';
  return formatMinutes(minutes);
};

const WEEK_DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 7;
const WAKING_WARN_THRESHOLD = 3;
const TREND_SIGNIFICANT_MIN = 15;

const fallbackSleepNorms = {
  night: { min: 9 * 60, max: 11 * 60, label: 'норма 9–11 ч' },
  nap: { min: 2 * 60, max: 4 * 60, label: 'норма 2–4 ч' },
  total: { min: 11 * 60, max: 14 * 60, label: 'норма 11–14 ч' },
  intervalNight: { min: 120, max: 240, label: 'перед ночью 2–4 ч' },
  intervalNap: { min: 90, max: 180, label: 'днём 1.5–3 ч' },
};

const getAgeMonths = (birthDateLike) => {
  if (!birthDateLike) return null;
  const birth = new Date(birthDateLike);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let months = (today.getFullYear() - birth.getFullYear()) * 12;
  months += today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
};

const formatWeekLabel = (mondayLike) => {
  const monday = new Date(mondayLike);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const startDay = monday.toLocaleDateString('ru-RU', { day: 'numeric' });
  const endDay = sunday.toLocaleDateString('ru-RU', { day: 'numeric' });
  const month = sunday.toLocaleDateString('ru-RU', { month: 'long' });
  return sameMonth ? `${startDay}–${endDay} ${month}` : `${startDay} ${monday.toLocaleDateString('ru-RU', { month: 'long' })} – ${endDay} ${month}`;
};

const sleepTypeByStart = (startDate) => {
  const hour = new Date(startDate).getHours();
  return (hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR) ? 'night' : 'nap';
};

const clampPercentByNorm = (value, min, max) => {
  if (value <= 0) return 0;
  const targetMax = max || min || 1;
  return Math.max(0, Math.min(100, (value / targetMax) * 100));
};

const formatTrend = (minutes) => {
  if (minutes === null || minutes === undefined) return '—';
  const abs = Math.round(Math.abs(minutes));
  const sign = minutes > 0 ? '+' : minutes < 0 ? '−' : '±';
  return `${sign}${abs} мин`;
};

const formatTime = (dateLike) => new Date(dateLike).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const getHeatLevel = (count, maxCount) => {
  if (!count || count <= 0 || maxCount <= 0) return 0;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

const heatLevelClasses = [
  'bg-orange-50',
  'bg-orange-100',
  'bg-orange-200',
  'bg-orange-300',
  'bg-orange-500',
];

const FeedingHeatmap = ({ matrix, maxCount }) => {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[350px] grid-cols-[34px_repeat(7,minmax(0,1fr))] gap-[3px]">
        <div />
        {WEEK_DAYS_SHORT.map((day) => (
          <div key={day} className="pb-1 text-center text-[11px] font-semibold text-gray-500">{day}</div>
        ))}
        {hours.map((hour) => (
          <React.Fragment key={hour}>
            <div className="flex items-center justify-end pr-1 text-[10px] font-medium text-gray-400">
              {hour % 3 === 0 ? `${String(hour).padStart(2, '0')}:00` : ''}
            </div>
            {WEEK_DAYS_SHORT.map((_, dayIndex) => {
              const count = matrix[hour][dayIndex];
              const level = getHeatLevel(count, maxCount);

              return (
                <div
                  key={`${hour}-${dayIndex}`}
                  className={`aspect-square rounded-[5px] ${heatLevelClasses[level]}`}
                  title={`${WEEK_DAYS_SHORT[dayIndex]}, ${String(hour).padStart(2, '0')}:00 — ${count} кормл.`}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-gray-400">
        <span>меньше</span>
        {heatLevelClasses.map((bgClass, index) => (
          <div key={index} className={`h-3 w-3 rounded-[3px] ${bgClass}`} />
        ))}
        <span>больше</span>
      </div>
    </div>
  );
};

const BottleByDayChart = ({ data }) => {
  const maxValue = Math.max(1, ...data.map((row) => row.bottle));

  return (
    <div>
      <div className="mb-4 flex h-52 items-end justify-between gap-2">
        {data.map((row, index) => (
          <div key={row.day} className="flex w-full flex-col items-center">
            <div className="mb-1 text-[10px] font-bold text-orange-500">{Math.round(row.bottle || 0)}</div>
            <div className="flex h-44 w-full max-w-10 flex-col-reverse overflow-hidden rounded-md bg-gray-100">
              <div className="bg-sky-400" style={{ height: `${((row.water || 0) / maxValue) * 100}%` }} />
              <div className="bg-pink-400" style={{ height: `${((row.breastMilk || 0) / maxValue) * 100}%` }} />
              <div className="bg-amber-400" style={{ height: `${((row.formula || 0) / maxValue) * 100}%` }} />
            </div>
            <div className="mt-2 text-xs font-semibold text-gray-500">{WEEK_DAYS_SHORT[index]}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 border-t border-orange-100 pt-3 text-xs text-gray-500">
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />Смесь</div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-pink-400" />Грудное молоко</div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-400" />Вода</div>
      </div>
    </div>
  );
};

const BreastBalanceChart = ({ data }) => {
  const leftTotal = Math.round(data.reduce((sum, item) => sum + (item.left || 0), 0));
  const rightTotal = Math.round(data.reduce((sum, item) => sum + (item.right || 0), 0));
  const total = leftTotal + rightTotal;
  const leftPct = total ? Math.round((leftTotal / total) * 100) : 50;
  const rightPct = total ? 100 - leftPct : 50;
  const maxDaily = Math.max(1, ...data.flatMap((item) => [item.left || 0, item.right || 0]));
  const chartWidth = 300;
  const chartHeight = 120;
  const leftPoints = data.map((row, index) => {
    const x = (index / Math.max(data.length - 1, 1)) * chartWidth;
    const y = chartHeight - ((row.left || 0) / maxDaily) * chartHeight;
    return `${x},${y}`;
  }).join(' ');
  const rightPoints = data.map((row, index) => {
    const x = (index / Math.max(data.length - 1, 1)) * chartWidth;
    const y = chartHeight - ((row.right || 0) / maxDaily) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-pink-50 p-3 text-center">
          <div className="text-[11px] font-bold uppercase tracking-wider text-pink-500">Левая</div>
          <div className="text-2xl font-extrabold leading-none text-pink-500">{leftTotal}</div>
          <div className="text-xs text-gray-500">мин за неделю</div>
        </div>
        <div className="rounded-xl bg-violet-50 p-3 text-center">
          <div className="text-[11px] font-bold uppercase tracking-wider text-violet-500">Правая</div>
          <div className="text-2xl font-extrabold leading-none text-violet-500">{rightTotal}</div>
          <div className="text-xs text-gray-500">мин за неделю</div>
        </div>
      </div>

      <div className="mb-1 flex justify-between text-xs text-gray-500">
        <span>{leftPct}%</span>
        <span>баланс груди</span>
        <span>{rightPct}%</span>
      </div>
      <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-orange-100">
        <div className="h-full bg-pink-400" style={{ width: `${leftPct}%` }} />
        <div className="h-full bg-violet-500" style={{ width: `${rightPct}%` }} />
      </div>

      <div className="mb-2 overflow-x-auto rounded-xl border border-orange-100 bg-orange-50 p-2">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-32 w-full min-w-[280px]">
          <polyline fill="none" stroke="#f472b6" strokeWidth="3" points={leftPoints} />
          <polyline fill="none" stroke="#a855f7" strokeWidth="3" points={rightPoints} />
          {data.map((row, index) => {
            const x = (index / Math.max(data.length - 1, 1)) * chartWidth;
            const yLeft = chartHeight - ((row.left || 0) / maxDaily) * chartHeight;
            const yRight = chartHeight - ((row.right || 0) / maxDaily) * chartHeight;
            return (
              <g key={row.day}>
                <circle cx={x} cy={yLeft} r="3.5" fill="#f472b6" />
                <circle cx={x} cy={yRight} r="3.5" fill="#a855f7" />
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex justify-between text-[10px] font-semibold text-gray-500">
          {WEEK_DAYS_SHORT.map((day) => (<span key={day}>{day}</span>))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-pink-400" />Левая</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" />Правая</div>
        </div>
      </div>
    </div>
  );
};

// Вынесенный компонент с метриками, чтобы экран статистики было проще расширять новыми типами.
const StatsActivityDetail = ({ selectedType, activities, weekStartDate, onWeekStartChange, babyBirthDate }) => {
  const currentMonday = useMemo(() => getMonday(), []);
  const selectedMonday = useMemo(() => {
    const candidate = weekStartDate ? getMonday(weekStartDate) : currentMonday;
    return candidate > currentMonday ? currentMonday : candidate;
  }, [weekStartDate, currentMonday]);

  const periodDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(selectedMonday);
      day.setDate(selectedMonday.getDate() + i);
      return toDayKey(day);
    });
  }, [selectedMonday]);
  const [selectedTimelineDay, setSelectedTimelineDay] = useState(periodDays[periodDays.length - 1]);
  const [sleepNorms, setSleepNorms] = useState(fallbackSleepNorms);

  useEffect(() => {
    let cancelled = false;

    const loadSleepNorms = async () => {
      const ageMonths = getAgeMonths(babyBirthDate);
      const { data, error } = await supabaseService.getWithCache('sleep_norms', {
        order: { column: 'age_min_months', ascending: true },
      });

      if (cancelled || error || !Array.isArray(data) || data.length === 0) {
        if (error) {
          console.warn('Не удалось загрузить нормы сна из БД, используется fallback:', error);
        }
        setSleepNorms(fallbackSleepNorms);
        return;
      }

      const selectedNorm = data.find((item) => {
        if (ageMonths === null) return false;
        const min = Number(item.age_min_months) || 0;
        const max = item.age_max_months === null ? Number.POSITIVE_INFINITY : Number(item.age_max_months);
        return ageMonths >= min && ageMonths <= max;
      }) || data[0];

      setSleepNorms({
        night: {
          min: Number(selectedNorm.night_min_minutes) || fallbackSleepNorms.night.min,
          max: Number(selectedNorm.night_max_minutes) || fallbackSleepNorms.night.max,
          label: selectedNorm.night_label || fallbackSleepNorms.night.label,
        },
        nap: {
          min: Number(selectedNorm.nap_min_minutes) || fallbackSleepNorms.nap.min,
          max: Number(selectedNorm.nap_max_minutes) || fallbackSleepNorms.nap.max,
          label: selectedNorm.nap_label || fallbackSleepNorms.nap.label,
        },
        total: {
          min: Number(selectedNorm.total_min_minutes) || fallbackSleepNorms.total.min,
          max: Number(selectedNorm.total_max_minutes) || fallbackSleepNorms.total.max,
          label: selectedNorm.total_label || fallbackSleepNorms.total.label,
        },
        intervalNight: {
          min: Number(selectedNorm.interval_before_night_min_minutes) || fallbackSleepNorms.intervalNight.min,
          max: Number(selectedNorm.interval_before_night_max_minutes) || fallbackSleepNorms.intervalNight.max,
          label: selectedNorm.interval_before_night_label || fallbackSleepNorms.intervalNight.label,
        },
        intervalNap: {
          min: Number(selectedNorm.interval_nap_min_minutes) || fallbackSleepNorms.intervalNap.min,
          max: Number(selectedNorm.interval_nap_max_minutes) || fallbackSleepNorms.intervalNap.max,
          label: selectedNorm.interval_nap_label || fallbackSleepNorms.intervalNap.label,
        },
      });
    };

    loadSleepNorms();

    return () => {
      cancelled = true;
    };
  }, [babyBirthDate]);

  useEffect(() => {
    if (!periodDays.includes(selectedTimelineDay)) {
      setSelectedTimelineDay(periodDays[periodDays.length - 1]);
    }
  }, [periodDays, selectedTimelineDay]);


  const handleWeekChange = (value) => {
    const monday = getMonday(value);
    if (monday > currentMonday) return;
    onWeekStartChange?.(toDateInputValue(monday));
  };

  const scopedActivities = useMemo(
    () => activities.filter((item) => item.startTime && periodDays.includes(toDayKey(item.startTime))),
    [activities, periodDays]
  );

  const feedingData = useMemo(() => {
    const dayMap = Object.fromEntries(periodDays.map((day) => [day, { day, left: 0, right: 0, bottle: 0, formula: 0, water: 0, breastMilk: 0, feedCount: 0 }]));

    scopedActivities.forEach((item) => {
      const day = toDayKey(item.startTime);
      if (!dayMap[day]) return;

      if (item.type === 'breastfeeding') {
        dayMap[day].left += (Number(item.leftDuration) || 0) / 60;
        dayMap[day].right += (Number(item.rightDuration) || 0) / 60;
        dayMap[day].feedCount += 1;
      }

      if (item.type === 'bottle') {
        const amount = Number(item.amount) || 0;
        dayMap[day].bottle += amount;
        dayMap[day].feedCount += 1;
        if (item.foodType === 'formula') dayMap[day].formula += amount;
        if (item.foodType === 'water') dayMap[day].water += amount;
        if (item.foodType === 'breast_milk') dayMap[day].breastMilk += amount;
      }
    });

    return periodDays.map((day) => dayMap[day]);
  }, [periodDays, scopedActivities]);

  const feedingIntervals = useMemo(() => {
    const feedingEvents = scopedActivities
      .filter((item) => item.type === 'breastfeeding' || item.type === 'bottle')
      .map((item) => {
        const start = new Date(item.startTime).getTime();
        const fallbackEnd = item.type === 'breastfeeding'
          ? start + ((Number(item.leftDuration) || 0) + (Number(item.rightDuration) || 0)) * 1000
          : start;
        const end = item.endTime ? new Date(item.endTime).getTime() : fallbackEnd;

        return { start, end, type: item.type };
      })
      .sort((a, b) => a.start - b.start);

    const computeAverage = (intervals) => {
      if (!intervals.length) return null;
      return intervals.reduce((acc, value) => acc + value, 0) / intervals.length;
    };

    const anyIntervals = [];
    const breastOnlyIntervals = [];
    const bottleOnlyIntervals = [];

    for (let i = 1; i < feedingEvents.length; i++) {
      const prev = feedingEvents[i - 1];
      const current = feedingEvents[i];
      const diffMinutes = (current.start - prev.end) / 60000;
      if (diffMinutes < 0) continue;
      anyIntervals.push(diffMinutes);
      if (prev.type === 'breastfeeding' && current.type === 'breastfeeding') breastOnlyIntervals.push(diffMinutes);
      if (prev.type === 'bottle' && current.type === 'bottle') bottleOnlyIntervals.push(diffMinutes);
    }

    return {
      any: computeAverage(anyIntervals),
      breastOnly: computeAverage(breastOnlyIntervals),
      bottleOnly: computeAverage(bottleOnlyIntervals),
    };
  }, [scopedActivities]);

  const averageFeedsPerDay = useMemo(() => {
    const total = feedingData.reduce((acc, day) => acc + day.feedCount, 0);
    return total / 7;
  }, [feedingData]);

  const feedingHeatmap = useMemo(() => {
    const matrix = Array.from({ length: 24 }, () => Array(7).fill(0));
    const periodDayIndex = Object.fromEntries(periodDays.map((day, index) => [day, index]));

    scopedActivities
      .filter((item) => item.type === 'breastfeeding' || item.type === 'bottle')
      .forEach((item) => {
        const dayIndex = periodDayIndex[toDayKey(item.startTime)];
        if (dayIndex === undefined) return;
        const hour = new Date(item.startTime).getHours();
        matrix[hour][dayIndex] += 1;
      });

    const maxCount = matrix.reduce((max, row) => Math.max(max, ...row), 0);

    return { matrix, maxCount };
  }, [scopedActivities]);

  const sleepByDay = useMemo(() => {
    const dayMap = Object.fromEntries(periodDays.map((day) => [day, { day, hours: 0 }]));

    scopedActivities
      .filter((item) => item.type === 'sleep' && item.startTime && item.endTime)
      .forEach((item) => {
        const day = toDayKey(item.startTime);
        if (!dayMap[day]) return;
        const durationHours = (new Date(item.endTime).getTime() - new Date(item.startTime).getTime()) / 3600000;
        dayMap[day].hours += Math.max(0, durationHours);
      });

    return periodDays.map((day) => dayMap[day]);
  }, [periodDays, scopedActivities]);

  const sleepWeekStats = useMemo(() => {
    const dayMap = Object.fromEntries(periodDays.map((day) => [day, {
      day,
      label: WEEK_DAYS_SHORT[new Date(`${day}T00:00:00`).getDay() === 0 ? 6 : new Date(`${day}T00:00:00`).getDay() - 1],
      nightMin: 0,
      napMin: 0,
      totalMin: 0,
      sessions: [],
    }]));

    const sleepSessions = scopedActivities
      .filter((item) => item.type === 'sleep' && item.startTime && item.endTime)
      .map((item) => {
        const start = new Date(item.startTime);
        const end = new Date(item.endTime);
        const durationMin = Math.max(0, (end.getTime() - start.getTime()) / 60000);
        return {
          id: item.id,
          day: toDayKey(start),
          start,
          end,
          durationMin,
          type: sleepTypeByStart(start),
        };
      })
      .filter((session) => dayMap[session.day]);

    sleepSessions.forEach((session) => {
      const dayRow = dayMap[session.day];
      dayRow.totalMin += session.durationMin;
      if (session.type === 'night') dayRow.nightMin += session.durationMin;
      else dayRow.napMin += session.durationMin;
      dayRow.sessions.push(session);
    });

    const perDay = periodDays.map((day) => dayMap[day]);
    const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const dayWithNight = perDay.filter((d) => d.nightMin > 0).map((d) => d.nightMin);
    const dayWithNap = perDay.filter((d) => d.napMin > 0).map((d) => d.napMin);
    const avgNight = avg(dayWithNight);
    const avgNap = avg(dayWithNap);
    const avgTotal = perDay.reduce((sum, d) => sum + d.totalMin, 0) / 7;

    const longestStretch = sleepSessions.reduce((max, item) => Math.max(max, item.durationMin), 0);
    const avgWakeCount = avg(perDay.map((d) => {
      const nightSessions = d.sessions.filter((s) => s.type === 'night').sort((a, b) => a.start - b.start);
      let count = 0;
      for (let i = 1; i < nightSessions.length; i++) {
        const gap = (nightSessions[i].start - nightSessions[i - 1].end) / 60000;
        if (gap >= 5) count += 1;
      }
      return count;
    }));

    const wakeIntervalsNight = [];
    const wakeIntervalsNap = [];
    const orderedByStart = sleepSessions.slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < orderedByStart.length; i++) {
      const gap = (orderedByStart[i].start - orderedByStart[i - 1].end) / 60000;
      if (gap < 0) continue;
      if (orderedByStart[i].type === 'night') wakeIntervalsNight.push(gap);
      else wakeIntervalsNap.push(gap);
    }

    const avgIntervalNight = avg(wakeIntervalsNight);
    const avgIntervalNap = avg(wakeIntervalsNap);

    return {
      perDay,
      avgNight,
      avgNap,
      avgTotal,
      longestStretch,
      avgWakeCount,
      avgIntervalNight,
      avgIntervalNap,
    };
  }, [periodDays, scopedActivities]);

  const previousWeekStats = useMemo(() => {
    const prevDays = periodDays.map((day) => {
      const d = new Date(`${day}T00:00:00`);
      d.setDate(d.getDate() - 7);
      return toDayKey(d);
    });
    const prevSet = new Set(prevDays);
    const prevActivities = activities.filter((item) => item.startTime && prevSet.has(toDayKey(item.startTime)));
    const totalsByDay = Object.fromEntries(prevDays.map((day) => [day, 0]));
    let night = 0;
    let nap = 0;

    prevActivities.filter((item) => item.type === 'sleep' && item.endTime).forEach((item) => {
      const start = new Date(item.startTime);
      const durationMin = Math.max(0, (new Date(item.endTime) - start) / 60000);
      const day = toDayKey(start);
      if (totalsByDay[day] === undefined) return;
      totalsByDay[day] += durationMin;
      if (sleepTypeByStart(start) === 'night') night += durationMin;
      else nap += durationMin;
    });

    return {
      totals: prevDays.map((day) => totalsByDay[day]),
      avgTotal: prevDays.reduce((sum, day) => sum + totalsByDay[day], 0) / 7,
      avgNight: night / 7,
      avgNap: nap / 7,
      hasData: Object.values(totalsByDay).some((value) => value > 0),
    };
  }, [activities, periodDays]);

  const selectedSleepTimeline = useMemo(() => {
    const dayStart = new Date(`${selectedTimelineDay}T00:00:00`).getTime();
    const dayEnd = dayStart + DAY_MS;

    return scopedActivities
      .filter((item) => item.type === 'sleep' && item.startTime && item.endTime && toDayKey(item.startTime) === selectedTimelineDay)
      .map((item) => {
        const start = Math.max(dayStart, new Date(item.startTime).getTime());
        const end = Math.min(dayEnd, new Date(item.endTime).getTime());
        const left = ((start - dayStart) / DAY_MS) * 100;
        const width = Math.max(1.2, ((end - start) / DAY_MS) * 100);

        return {
          id: item.id,
          left,
          width,
          startLabel: new Date(start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          endLabel: new Date(end).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        };
      });
  }, [scopedActivities, selectedTimelineDay]);

  const activityVsSleep = useMemo(() => {
    let sleepMinutes = 0;
    let awakeMinutes = 0;

    scopedActivities.forEach((item) => {
      if (!item.startTime || !item.endTime) return;
      const durationMinutes = Math.max(0, (new Date(item.endTime) - new Date(item.startTime)) / 60000);
      if (item.type === 'sleep') sleepMinutes += durationMinutes;
      if (item.type === 'activity' || item.type === 'walk') awakeMinutes += durationMinutes;
    });

    return { sleepMinutes, awakeMinutes };
  }, [scopedActivities]);

  const awakeBetweenSleeps = useMemo(() => {
    const sleeps = scopedActivities
      .filter((item) => item.type === 'sleep' && item.startTime && item.endTime)
      .map((item) => ({ start: new Date(item.startTime).getTime(), end: new Date(item.endTime).getTime() }))
      .sort((a, b) => a.start - b.start);

    const intervals = [];
    for (let i = 1; i < sleeps.length; i++) {
      const diff = (sleeps[i].start - sleeps[i - 1].end) / 60000;
      if (diff >= 0) intervals.push(diff);
    }

    if (!intervals.length) return null;
    return intervals.reduce((acc, item) => acc + item, 0) / intervals.length;
  }, [scopedActivities]);

  const diaperByDay = useMemo(() => {
    const dayMap = Object.fromEntries(periodDays.map((day) => [day, { day, total: 0, wet: 0, dirty: 0 }]));

    scopedActivities
      .filter((item) => item.type === 'diaper')
      .forEach((item) => {
        const day = toDayKey(item.startTime);
        if (!dayMap[day]) return;
        dayMap[day].total += 1;
        if (item.diaperType === 'wet') dayMap[day].wet += 1;
        if (item.diaperType === 'dirty') dayMap[day].dirty += 1;
      });

    return periodDays.map((day) => dayMap[day]);
  }, [periodDays, scopedActivities]);

  if (selectedType === 'breastfeeding' || selectedType === 'bottle' || selectedType === 'feeding') {
    return (
      <div className="space-y-4">
        <WeekPickerCard selectedMonday={selectedMonday} currentMonday={currentMonday} onWeekStartChange={onWeekStartChange} />

        <StatsCard title="Интервалы между кормлениями">
          {feedingData.some((item) => item.feedCount) ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <MetricPill label="Любые кормления" value={formatInterval(feedingIntervals.any)} color="bg-blue-50 text-blue-700" />
              <MetricPill label="Только ГВ подряд" value={formatInterval(feedingIntervals.breastOnly)} color="bg-pink-50 text-pink-700" />
              <MetricPill label="Только бутылочка подряд" value={formatInterval(feedingIntervals.bottleOnly)} color="bg-cyan-50 text-cyan-700" />
            </div>
          ) : (
            <EmptyState text="Недостаточно данных, чтобы вычислить интервалы." />
          )}
        </StatsCard>

        <StatsCard title="Среднее количество кормлений в день">
          <MetricPill label="Среднее значение" value={`${Math.round(averageFeedsPerDay)} раз/день`} color="bg-violet-50 text-violet-700" />
        </StatsCard>

        <FeedingSectionCard
          title="Время кормлений по дням"
          emoji="🕐"
          desc="Когда малыш чаще всего просит кушать. Тёмнее — больше кормлений в этот час."
          tip="Как читать: строки — часы суток (с 0:00 до 23:00), столбцы — дни недели. Самые тёмные клетки — пик кормлений."
        >
          {feedingHeatmap.maxCount > 0 ? (
            <FeedingHeatmap matrix={feedingHeatmap.matrix} maxCount={feedingHeatmap.maxCount} />
          ) : (
            <EmptyState text="За выбранную неделю нет записей кормлений." />
          )}
        </FeedingSectionCard>

        <FeedingSectionCard
          title="Кормление из бутылочки"
          emoji="🍼"
          desc="Сколько и чего малыш пил из бутылочки каждый день — смесь, грудное молоко, вода."
          tip="Как читать: высота всего столбца — суммарный объём за день (мл). Цветные сегменты показывают состав."
        >
          {feedingData.some((item) => item.bottle) ? (
            <BottleByDayChart data={feedingData} />
          ) : (
            <EmptyState text="За 7 дней нет записей по бутылочке." />
          )}
        </FeedingSectionCard>

        <FeedingSectionCard
          title="Баланс груди"
          emoji="🤱"
          desc="Сколько времени малыш кормился у каждой груди, чтобы выработка молока оставалась равномерной."
          tip="Ориентир: разница до 10–15% — обычно нормальна."
        >
          {feedingData.some((item) => item.left || item.right) ? (
            <BreastBalanceChart data={feedingData} />
          ) : (
            <EmptyState text="За 7 дней нет записей кормления грудью." />
          )}
        </FeedingSectionCard>
      </div>
    );
  }

  if (selectedType === 'sleep') {
    const trendTotal = previousWeekStats.hasData ? sleepWeekStats.avgTotal - previousWeekStats.avgTotal : null;
    const trendNight = previousWeekStats.hasData ? sleepWeekStats.avgNight - previousWeekStats.avgNight : null;
    const trendNap = previousWeekStats.hasData ? sleepWeekStats.avgNap - previousWeekStats.avgNap : null;
    const shouldWarn = sleepWeekStats.avgWakeCount >= WAKING_WARN_THRESHOLD || sleepWeekStats.avgTotal < sleepNorms.total.min;

    return (
      <div className="space-y-4"> 
        <WeekPickerCard selectedMonday={selectedMonday} currentMonday={currentMonday} onWeekStartChange={onWeekStartChange} />

        <StatsCard title="Умные алерты">
          <div className="space-y-2">
            {shouldWarn ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Сон ниже целевых значений или много ночных пробуждений. Проверьте режим укладывания и длительность дневных окон.</div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Режим сна стабильный, серьёзных отклонений по неделе не обнаружено.</div>
            )}
            {trendTotal !== null && Math.abs(trendTotal) >= TREND_SIGNIFICANT_MIN ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">По сравнению с прошлой неделей суточный сон изменился на {formatTrend(trendTotal)}.</div>
            ) : null}
          </div>
        </StatsCard>

        <StatsCard title="Средние значения">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-indigo-50 p-3"><div className="text-xs text-indigo-500">Ночной сон</div><div className="text-xl font-extrabold text-indigo-700">{formatMinutes(sleepWeekStats.avgNight)}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-indigo-100"><div className="h-full bg-indigo-500" style={{ width: `${clampPercentByNorm(sleepWeekStats.avgNight, sleepNorms.night.min, sleepNorms.night.max)}%` }} /></div><div className="text-[11px] text-gray-500">{sleepNorms.night.label}</div></div>
            <div className="rounded-xl bg-amber-50 p-3"><div className="text-xs text-amber-500">Дневной сон</div><div className="text-xl font-extrabold text-amber-700">{formatMinutes(sleepWeekStats.avgNap)}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-amber-100"><div className="h-full bg-amber-500" style={{ width: `${clampPercentByNorm(sleepWeekStats.avgNap, sleepNorms.nap.min, sleepNorms.nap.max)}%` }} /></div><div className="text-[11px] text-gray-500">{sleepNorms.nap.label}</div></div>
            <div className="rounded-xl bg-emerald-50 p-3"><div className="text-xs text-emerald-500">Суточный итог</div><div className="text-xl font-extrabold text-emerald-700">{formatMinutes(sleepWeekStats.avgTotal)}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-100"><div className="h-full bg-emerald-500" style={{ width: `${clampPercentByNorm(sleepWeekStats.avgTotal, sleepNorms.total.min, sleepNorms.total.max)}%` }} /></div><div className="text-[11px] text-gray-500">{sleepNorms.total.label}</div></div>
            <div className="rounded-xl bg-violet-50 p-3"><div className="text-xs text-violet-500">Длинный непрерывный</div><div className="text-xl font-extrabold text-violet-700">{formatMinutes(sleepWeekStats.longestStretch)}</div><div className="text-[11px] text-gray-500">цель 6+ часов</div></div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <MetricPill label={`Интервал перед ночью · ${sleepNorms.intervalNight.label}`} value={formatMinutes(sleepWeekStats.avgIntervalNight)} color="bg-indigo-50 text-indigo-700" />
            <MetricPill label={`Интервал днём · ${sleepNorms.intervalNap.label}`} value={formatMinutes(sleepWeekStats.avgIntervalNap)} color="bg-amber-50 text-amber-700" />
          </div>
        </StatsCard>

        <StatsCard title="Общий сон по дням + тренд">
          {previousWeekStats.hasData ? (
            <div className="mb-3 grid grid-cols-3 gap-2">
              <MetricPill label="Суточный" value={formatTrend(trendTotal)} color="bg-emerald-50 text-emerald-700" />
              <MetricPill label="Ночной" value={formatTrend(trendNight)} color="bg-indigo-50 text-indigo-700" />
              <MetricPill label="Дневной" value={formatTrend(trendNap)} color="bg-amber-50 text-amber-700" />
            </div>
          ) : null}
          <div className="space-y-2">
            {sleepWeekStats.perDay.map((day, i) => {
              const prev = previousWeekStats.totals[i] || 0;
              const maxVal = Math.max(1, ...sleepWeekStats.perDay.map((d) => d.totalMin), ...previousWeekStats.totals);
              return (
                <div key={day.day}>
                  <div className="mb-1 flex justify-between text-xs text-gray-500"><span>{day.label}</span><span>{formatMinutes(day.totalMin)} {previousWeekStats.hasData ? `· прошлая ${formatMinutes(prev)}` : ''}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-emerald-500" style={{ width: `${(day.totalMin / maxVal) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </StatsCard>

        <StatsCard title="Ночные пробуждения">
          <div className="grid grid-cols-7 gap-1">
            {sleepWeekStats.perDay.map((day) => {
              const nightSessions = day.sessions.filter((s) => s.type === 'night').sort((a, b) => a.start - b.start);
              const wakeTimes = [];
              for (let i = 1; i < nightSessions.length; i++) {
                const gap = (nightSessions[i].start - nightSessions[i - 1].end) / 60000;
                if (gap >= 5) wakeTimes.push(formatTime(nightSessions[i - 1].end));
              }
              const wakeCount = wakeTimes.length;
              return (
                <div key={day.day} className="rounded-xl border border-indigo-100 bg-indigo-50 p-2 text-center">
                  <div className="text-[11px] font-semibold text-gray-500">{day.label}</div>
                  <div className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${wakeCount >= WAKING_WARN_THRESHOLD ? 'bg-red-100 text-red-600' : wakeCount === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>{wakeCount}</div>
                  <div className="mt-1 text-[10px] text-gray-500">{wakeTimes.length ? wakeTimes.slice(0, 2).join(', ') : '—'}</div>
                </div>
              );
            })}
          </div>
        </StatsCard>
      </div>
    );
  }


  if (selectedType === 'activity' || selectedType === 'walk') {
    return (
      <div className="space-y-4">
        <WeekPickerCard selectedMonday={selectedMonday} currentMonday={currentMonday} onWeekStartChange={onWeekStartChange} />

        <StatsCard title="Сон и бодрствование за 7 дней">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <MetricPill label="Сон" value={formatMinutes(activityVsSleep.sleepMinutes)} color="bg-indigo-50 text-indigo-700" />
            <MetricPill label="Бодрствование (активность + прогулка)" value={formatMinutes(activityVsSleep.awakeMinutes)} color="bg-orange-50 text-orange-700" />
          </div>
        </StatsCard>

        <StatsCard title="Среднее бодрствование между снами">
          {awakeBetweenSleeps !== null ? (
            <MetricPill label="Среднее значение" value={formatMinutes(awakeBetweenSleeps)} color="bg-violet-50 text-violet-700" />
          ) : (
            <EmptyState text="Нужно минимум два завершённых сна для расчёта." />
          )}
        </StatsCard>
      </div>
    );
  }

  if (selectedType === 'diaper') {
    return (
      <div className="space-y-4">
        <WeekPickerCard selectedMonday={selectedMonday} currentMonday={currentMonday} onWeekStartChange={onWeekStartChange} />

      <StatsCard title="Подгузники по дням (всего / мокрые / грязные)">
        {diaperByDay.some((item) => item.total) ? (
          <div className="space-y-2">
            {diaperByDay.map((item) => (
              <div key={item.day} className="rounded-xl bg-yellow-50 p-3 border border-yellow-100">
                <div className="text-sm font-medium text-yellow-900 mb-1">{formatDayLabel(item.day)}</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>Всего: <span className="font-semibold">{item.total}</span></div>
                  <div>Мокрые: <span className="font-semibold">{item.wet}</span></div>
                  <div>Грязные: <span className="font-semibold">{item.dirty}</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="За 7 дней нет записей о подгузниках." />
        )}
      </StatsCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WeekPickerCard selectedMonday={selectedMonday} currentMonday={currentMonday} onWeekStartChange={onWeekStartChange} />
      <EmptyState text="Для этой активности детальные метрики пока не настроены." />
    </div>
  );
};

export default StatsActivityDetail;
