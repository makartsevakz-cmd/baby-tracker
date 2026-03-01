import React, { useEffect, useMemo, useState } from 'react';

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
    <div className="space-y-3">
      {data.map((row) => (
        <div key={row.day}>
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>{formatDayLabel(row.day)}</span>
            <span>{Math.round(row.bottle || 0)} мл</span>
          </div>
          <div className="flex h-4 overflow-hidden rounded-lg bg-gray-100">
            <div className="h-full bg-amber-400" style={{ width: `${((row.formula || 0) / maxValue) * 100}%` }} />
            <div className="h-full bg-pink-400" style={{ width: `${((row.breastMilk || 0) / maxValue) * 100}%` }} />
            <div className="h-full bg-sky-400" style={{ width: `${((row.water || 0) / maxValue) * 100}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Смесь: {Math.round(row.formula || 0)} мл · Грудное молоко: {Math.round(row.breastMilk || 0)} мл · Вода: {Math.round(row.water || 0)} мл
          </div>
        </div>
      ))}
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

      <div className="space-y-2">
        {data.map((row) => (
          <div key={row.day}>
            <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>{formatDayLabel(row.day)}</span>
              <span>{Math.round(row.left || 0)} / {Math.round(row.right || 0)} мин</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-pink-300" style={{ width: `${((row.left || 0) / maxDaily) * 100}%` }} />
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-violet-400" style={{ width: `${((row.right || 0) / maxDaily) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Вынесенный компонент с метриками, чтобы экран статистики было проще расширять новыми типами.
const StatsActivityDetail = ({ selectedType, activities, weekStartDate, onWeekStartChange }) => {
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
        <StatsCard title="Период">
          <div className="text-xs text-gray-500 mb-2">Выберите понедельник недели</div>
          <input
            type="date"
            value={toDateInputValue(selectedMonday)}
            min={mondayDateInputMin}
            max={toDateInputValue(currentMonday)}
            step={7}
            onChange={(e) => handleWeekChange(e.target.value)}
            className="w-full rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm"
          />
        </StatsCard>

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

        <StatsCard title="Время кормлений по дням">
          {feedingHeatmap.maxCount > 0 ? (
            <FeedingHeatmap matrix={feedingHeatmap.matrix} maxCount={feedingHeatmap.maxCount} />
          ) : (
            <EmptyState text="За выбранную неделю нет записей кормлений." />
          )}
        </StatsCard>

        <StatsCard title="Кормление из бутылочки">
          {feedingData.some((item) => item.bottle) ? (
            <BottleByDayChart data={feedingData} />
          ) : (
            <EmptyState text="За 7 дней нет записей по бутылочке." />
          )}
        </StatsCard>

        <StatsCard title="Баланс груди">
          {feedingData.some((item) => item.left || item.right) ? (
            <BreastBalanceChart data={feedingData} />
          ) : (
            <EmptyState text="За 7 дней нет записей кормления грудью." />
          )}
        </StatsCard>
      </div>
    );
  }

  if (selectedType === 'sleep') {
    return (
      <div className="space-y-4">
        <StatsCard title="Сон: суммарная длительность по дням">
          {sleepByDay.some((item) => item.hours) ? (
            <SingleBarChart data={sleepByDay} valueKey="hours" color="bg-indigo-300" unit="ч" />
          ) : (
            <EmptyState text="За 7 дней нет завершённых сессий сна." />
          )}
        </StatsCard>

        <StatsCard title="Таймлайн сна за выбранный день">
          <div className="mb-3">
            <select
              className="w-full rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm"
              value={selectedTimelineDay}
              onChange={(e) => setSelectedTimelineDay(e.target.value)}
            >
              {periodDays.map((day) => (
                <option key={day} value={day}>{formatDayLabel(day)}</option>
              ))}
            </select>
          </div>
          {selectedSleepTimeline.length ? (
            <SleepTimeline sessions={selectedSleepTimeline} />
          ) : (
            <EmptyState text="В выбранный день нет завершённых периодов сна." />
          )}
        </StatsCard>
      </div>
    );
  }

  if (selectedType === 'activity' || selectedType === 'walk') {
    return (
      <div className="space-y-4">
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
    );
  }

  return <EmptyState text="Для этой активности детальные метрики пока не настроены." />;
};

export default StatsActivityDetail;
