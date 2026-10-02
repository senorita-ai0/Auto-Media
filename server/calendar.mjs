function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
}

const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return 9 * 60;
  return Math.max(0, Math.min(23, Number(match[1]))) * 60 + Math.max(0, Math.min(59, Number(match[2])));
}

function localDateKey(date, timezone) {
  const parts = zonedParts(date, timezone);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function atLocalTime(date, timezone, atMinutes) {
  const start = new Date(date);
  for (let i = 0; i < 36; i++) {
    const parts = zonedParts(start, timezone);
    const current = Number(parts.hour) * 60 + Number(parts.minute);
    const delta = atMinutes - current;
    const candidate = new Date(start.getTime() + delta * 60000);
    const check = zonedParts(candidate, timezone);
    if (Number(check.hour) * 60 + Number(check.minute) === atMinutes) return candidate;
    start.setTime(start.getTime() + 60 * 60000);
  }
  return new Date(date.getTime() + atMinutes * 60000);
}

export function nextAutomationRun(automation, from = new Date()) {
  if (!automation?.enabled || automation.schedule_type === "manual") return null;
  const timezone = automation.timezone || "UTC";
  const type = automation.schedule_type || "interval";
  if (type === "interval") {
    const minutes = Math.max(1, Number(automation.schedule_config_json?.intervalMinutes || 360));
    return new Date(from.getTime() + minutes * 60000);
  }

  const at = clockMinutes(automation.schedule_config_json?.atTime || "09:00");
  const dayWindow = type === "weekly" ? 14 : 3;
  for (let dayOffset = 0; dayOffset <= dayWindow; dayOffset++) {
    const probe = new Date(from.getTime() + dayOffset * 86400000);
    const parts = zonedParts(probe, timezone);
    if (type === "weekly") {
      const allowed = Array.isArray(automation.schedule_config_json?.days)
        ? automation.schedule_config_json.days.map(Number)
        : [1];
      if (!allowed.includes(weekdayMap[parts.weekday])) continue;
    }
    const candidate = atLocalTime(probe, timezone, at);
    if (candidate > from) return candidate;
  }
  return null;
}

export function expandAutomationCalendar(automations, start, end) {
  const events = [];
  for (const automation of automations || []) {
    const cursor = new Date(start);
    const timezone = automation.timezone || "UTC";
    const type = automation.schedule_type || "interval";
    if (!automation.enabled || type === "manual") continue;

    if (type === "interval") {
      const minutes = Math.max(1, Number(automation.schedule_config_json?.intervalMinutes || 360));
      const step = minutes * 60000;
      const aligned = new Date(cursor.getTime() - (cursor.getTime() % step));
      let current = aligned;
      if (current < cursor) current = new Date(current.getTime() + step);
      while (current <= end) {
        events.push({
          id: automation.id + ":" + current.toISOString(),
          automationId: automation.id,
          title: automation.name,
          profileName: automation.profile_name,
          contentTypeName: automation.content_type_name,
          kind: "automation",
          start: current.toISOString(),
          timezone
        });
        current = new Date(current.getTime() + step);
      }
      continue;
    }

    const allowedDays = type === "weekly"
      ? (Array.isArray(automation.schedule_config_json?.days) ? automation.schedule_config_json.days.map(Number) : [1])
      : null;
    const at = clockMinutes(automation.schedule_config_json?.atTime || "09:00");

    for (let day = 0; day <= Math.ceil((end - start) / 86400000) + 1; day++) {
      const probe = new Date(start.getTime() + day * 86400000);
      const parts = zonedParts(probe, timezone);
      if (allowedDays && !allowedDays.includes(weekdayMap[parts.weekday])) continue;
      const candidate = atLocalTime(probe, timezone, at);
      if (candidate < start || candidate > end) continue;
      events.push({
        id: automation.id + ":" + candidate.toISOString(),
        automationId: automation.id,
        title: automation.name,
        profileName: automation.profile_name,
        contentTypeName: automation.content_type_name,
        kind: "automation",
        start: candidate.toISOString(),
        timezone
      });
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export { localDateKey };
