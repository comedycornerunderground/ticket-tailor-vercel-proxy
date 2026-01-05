// api/cron-weekly-schedule.js
// Weekly cron job to post schedule to Slack channel
// Triggered every Monday at 9am UTC

import { getEventsForWeek, getEventsForDays } from './lib/event-fetcher.js';
import { formatWeeklySchedule, getAvailableSlotsWeekly, formatWeeklyShiftSummary } from './lib/schedule-formatter.js';
import { postMessage } from './lib/slack-client.js';
import { generateScheduleId, storeSchedulePost, getSchedule } from './lib/schedule-store.js';

export default async function handler(req, res) {
  // Verify this is a cron job request (Vercel adds this header)
  // Allow ?test=true for manual testing
  const authHeader = req.headers.authorization;
  const isTest = req.query.test === 'true';

  if (!isTest && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('Starting weekly schedule cron...');

    // Get channel ID from environment
    const channel = process.env.WEEKLY_CHANNEL;

    if (!channel) {
      throw new Error('WEEKLY_CHANNEL not configured');
    }

    // Get this week's events
    const events = await getEventsForWeek();

    console.log(`Found ${events.length} events for this week`);

    if (events.length === 0) {
      console.log('No events found for this week');

      // Post a message saying no events
      await postMessage(channel, 'No shows scheduled this week.');

      // Still post shift summaries to channels 1 and 2
      await postShiftSummaries();

      return res.status(200).json({
        success: true,
        message: 'No events found for this week'
      });
    }

    // Generate schedule ID (week starting date)
    const today = new Date();
    const weekStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const scheduleId = generateScheduleId('weekly', weekStart);

    // Format the schedule
    const { text, blocks, hasShowcase } = formatWeeklySchedule(
      events,
      {}, // No assignments yet
      scheduleId
    );

    // Post to channel
    console.log(`Posting to channel: ${channel}`);
    const result = await postMessage(channel, text, blocks);

    if (!result.ok) {
      throw new Error('Failed to post message to Slack');
    }

    console.log(`Posted to channel, ts: ${result.ts}`);

    // Store schedule info (only if there are showcase slots)
    if (hasShowcase) {
      const availableSlots = getAvailableSlotsWeekly(events, {});

      await storeSchedulePost(scheduleId, {
        type: 'weekly',
        period: weekStart,
        channel,
        ts: result.ts,
        events: events.map(e => ({
          id: e.id,
          name: e.name,
          date: e.date,
          unix: e.unix
        })),
        slots: availableSlots,
        assignments: {}
      });

      console.log('Weekly schedule stored with', availableSlots.length, 'available slots');

      // Post shift summaries to channels 1 and 2
      await postShiftSummaries();

      return res.status(200).json({
        success: true,
        scheduleId,
        weekStart,
        eventCount: events.length,
        slotCount: availableSlots.length,
        hasShowcase: true
      });
    }

    // No showcase slots - just log it
    console.log('No showcase slots this week (all shows are "and" format)');

    // Still post shift summaries to channels 1 and 2
    await postShiftSummaries();

    return res.status(200).json({
      success: true,
      scheduleId: null,
      weekStart,
      eventCount: events.length,
      hasShowcase: false,
      message: 'No showcase slots this week'
    });

  } catch (error) {
    console.error('Weekly cron error:', error);
    return res.status(500).json({
      error: 'Failed to post weekly schedule',
      message: error.message
    });
  }
}

/**
 * Get day of week from ISO date string
 */
function getDayFromISODate(isoDate) {
  const datePart = isoDate.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0);
  return localDate.getDay();
}

/**
 * Post shift summaries to channels 1 and 2
 * Shows who's signed up for shifts this week based on monthly schedule assignments
 */
async function postShiftSummaries() {
  const channel1 = process.env.MONTHLY_CHANNEL_1;
  const channel2 = process.env.MONTHLY_CHANNEL_2;

  if (!channel1 || !channel2) {
    console.log('MONTHLY_CHANNEL_1 or MONTHLY_CHANNEL_2 not configured, skipping shift summaries');
    return;
  }

  // Get the current month's schedule ID
  const today = new Date();
  const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const scheduleId1 = generateScheduleId('monthly', `${period}-ch1`);
  const scheduleId2 = generateScheduleId('monthly', `${period}-ch2`);

  // Get all events for this week (unfiltered - we'll filter per channel)
  const allWeekEvents = await getEventsForDays(new Date(), 7);

  // Channel 1: includes Wednesdays
  const ch1Events = allWeekEvents.filter(event => {
    const day = getDayFromISODate(event.date);
    // Skip Thursdays and Open Mics (except Friday Open Mic)
    if (day === 4) return false;
    const isOpenMic = event.name.toLowerCase().includes('open mic');
    const isFridayOpenMic = isOpenMic && event.name.toLowerCase().includes('friday');
    if (isOpenMic && !isFridayOpenMic) return false;
    return true;
  });

  // Channel 2: Fri/Sat only (excludes Wednesdays and Friday Open Mic)
  const ch2Events = allWeekEvents.filter(event => {
    const day = getDayFromISODate(event.date);
    // Skip Thursdays
    if (day === 4) return false;
    // Skip Wednesdays
    if (day === 3) return false;
    // Skip all Open Mics
    if (event.name.toLowerCase().includes('open mic')) return false;
    return true;
  });

  // Try to get monthly schedules and post summaries
  const schedule1 = await getSchedule(scheduleId1);
  const schedule2 = await getSchedule(scheduleId2);

  // Post to channel 1
  if (schedule1 && schedule1.assignments && ch1Events.length > 0) {
    const summary1 = formatWeeklyShiftSummary(ch1Events, schedule1.assignments);
    if (summary1) {
      console.log(`Posting shift summary to channel 1: ${summary1.text}`);
      await postMessage(channel1, summary1.text, summary1.blocks);
    } else {
      console.log('No assignments for channel 1 this week');
    }
  } else {
    console.log(`No monthly schedule found for channel 1 (${scheduleId1}) or no events this week`);
  }

  // Post to channel 2
  if (schedule2 && schedule2.assignments && ch2Events.length > 0) {
    const summary2 = formatWeeklyShiftSummary(ch2Events, schedule2.assignments);
    if (summary2) {
      console.log(`Posting shift summary to channel 2: ${summary2.text}`);
      await postMessage(channel2, summary2.text, summary2.blocks);
    } else {
      console.log('No assignments for channel 2 this week');
    }
  } else {
    console.log(`No monthly schedule found for channel 2 (${scheduleId2}) or no events this week`);
  }
}
