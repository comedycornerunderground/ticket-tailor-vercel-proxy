// api/debug-shift-summary.js
// Debug endpoint to preview weekly shift summaries for channels 1 and 2

import { getEventsForDays } from './lib/event-fetcher.js';
import { formatWeeklyShiftSummary } from './lib/schedule-formatter.js';
import { generateScheduleId, getSchedule } from './lib/schedule-store.js';

function getDayFromISODate(isoDate) {
  const datePart = isoDate.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0);
  return localDate.getDay();
}

export default async function handler(req, res) {
  try {
    // Get the current month's schedule IDs
    const today = new Date();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const scheduleId1 = generateScheduleId('monthly', `${period}-ch1`);
    const scheduleId2 = generateScheduleId('monthly', `${period}-ch2`);

    // Get all events for this week
    const allWeekEvents = await getEventsForDays(new Date(), 7);

    // Channel 1: includes Wednesdays
    const ch1Events = allWeekEvents.filter(event => {
      const day = getDayFromISODate(event.date);
      if (day === 4) return false; // Skip Thursdays
      const isOpenMic = event.name.toLowerCase().includes('open mic');
      const isFridayOpenMic = isOpenMic && event.name.toLowerCase().includes('friday');
      if (isOpenMic && !isFridayOpenMic) return false;
      return true;
    });

    // Channel 2: Fri/Sat only
    const ch2Events = allWeekEvents.filter(event => {
      const day = getDayFromISODate(event.date);
      if (day === 4) return false; // Skip Thursdays
      if (day === 3) return false; // Skip Wednesdays
      if (event.name.toLowerCase().includes('open mic')) return false;
      return true;
    });

    // Get schedules
    const schedule1 = await getSchedule(scheduleId1);
    const schedule2 = await getSchedule(scheduleId2);

    // Generate summaries
    const summary1 = schedule1 && schedule1.assignments
      ? formatWeeklyShiftSummary(ch1Events, schedule1.assignments)
      : null;
    const summary2 = schedule2 && schedule2.assignments
      ? formatWeeklyShiftSummary(ch2Events, schedule2.assignments)
      : null;

    return res.status(200).json({
      period,
      channel1: {
        scheduleId: scheduleId1,
        hasSchedule: !!schedule1,
        eventsThisWeek: ch1Events.map(e => ({
          name: e.name,
          date: e.date,
          dateKey: `${new Date(e.date).getMonth() + 1}/${new Date(e.date).getDate()}`
        })),
        assignments: schedule1?.assignments || {},
        summary: summary1
      },
      channel2: {
        scheduleId: scheduleId2,
        hasSchedule: !!schedule2,
        eventsThisWeek: ch2Events.map(e => ({
          name: e.name,
          date: e.date,
          dateKey: `${new Date(e.date).getMonth() + 1}/${new Date(e.date).getDate()}`
        })),
        assignments: schedule2?.assignments || {},
        summary: summary2
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
