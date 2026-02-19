import React, { useMemo, useState } from 'react';

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

const DailyBarChart = ({ data, leftKey, rightKey, leftColor, rightColor, unit }) => {
  const maxValue = Math.max(1, ...data.flatMap((row) => [row[leftKey] || 0, row[rightKey] || 0]));

  return (
    <div className="space-y-3">
      {data.map((row) => (
        <div key={row.day}>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{formatDayLabel(row.day)}</span>
            <span>
              {Math.round(row[leftKey] || 0)} / {Math.round(row[rightKey] || 0)} {unit}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${leftColor}`} style={{ width: `${((row[leftKey] || 0) / maxValue) * 100}%` }} />
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${rightColor}`} style={{ width: `${((row[rightKey] || 0) / maxValue) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

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

const buildPeriodDays = (daysCount = 7) => {
  const days = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = daysCount - 1; i >= 0; i--) {
    days.push(toDayKey(new Date(todayStart.getTime() - i * DAY_MS)));
  }

  return days;
};

// Вынесенный компонент с метриками, чтобы экран статистики было проще расширять новыми типами.
const StatsActivityDetail = ({ selectedType, activities }) => {
  const periodDays = useMemo(() => buildPeriodDays(7), []);
  const [selectedTimelineDay, setSelectedTimelineDay] = useState(periodDays[periodDays.length - 1]);

  const scopedActivities = useMemo(
    () => activities.filter((item) => item.startTime && periodDays.includes(toDayKey(item.startTime))),
    [activities, periodDays]
  );

  const feedingData = useMemo(() => {
    const dayMap = Object.fromEntries(periodDays.map((day) => [day, { day, left: 0, right: 0, bottle: 0 }]));

    scopedActivities.forEach((item) => {
      const day = toDayKey(item.startTime);
      if (!dayMap[day]) return;

      if (item.type === 'breastfeeding') {
        dayMap[day].left += Number(item.leftDuration) || 0;
        dayMap[day].right += Number(item.rightDuration) || 0;
      }

      if (item.type === 'bottle') {
        dayMap[day].bottle += Number(item.amount) || 0;
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
          ? start + ((Number(item.leftDuration) || 0) + (Number(item.rightDuration) || 0)) * 60000
          : start;
        const end = item.endTime ? new Date(item.endTime).getTime() : fallbackEnd;

        return { start, end };
      })
      .sort((a, b) => a.start - b.start);

    const intervals = [];
    for (let i = 1; i < feedingEvents.length; i++) {
      const diffMinutes = (feedingEvents[i].start - feedingEvents[i - 1].end) / 60000;
      if (diffMinutes >= 0) intervals.push(diffMinutes);
    }

    if (!intervals.length) return null;

    const total = intervals.reduce((acc, value) => acc + value, 0);
    return {
      avg: total / intervals.length,
      min: Math.min(...intervals),
      max: Math.max(...intervals),
    };
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
        <StatsCard title="Кормление грудью: минуты по дням (левая/правая)">
          {feedingData.some((item) => item.left || item.right) ? (
            <DailyBarChart data={feedingData} leftKey="left" rightKey="right" leftColor="bg-pink-300" rightColor="bg-fuchsia-400" unit="мин" />
          ) : (
            <EmptyState text="За 7 дней нет записей кормления грудью." />
          )}
        </StatsCard>

        <StatsCard title="Интервалы между кормлениями">
          {feedingIntervals ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <MetricPill label="Средний" value={formatMinutes(feedingIntervals.avg)} color="bg-blue-50 text-blue-700" />
              <MetricPill label="Минимальный" value={formatMinutes(feedingIntervals.min)} color="bg-emerald-50 text-emerald-700" />
              <MetricPill label="Максимальный" value={formatMinutes(feedingIntervals.max)} color="bg-amber-50 text-amber-700" />
            </div>
          ) : (
            <EmptyState text="Недостаточно данных, чтобы вычислить интервалы." />
          )}
        </StatsCard>

        <StatsCard title="Бутылочка: объём по дням">
          {feedingData.some((item) => item.bottle) ? (
            <SingleBarChart data={feedingData} valueKey="bottle" color="bg-sky-300" unit="мл" />
          ) : (
            <EmptyState text="За 7 дней нет записей по бутылочке." />
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
