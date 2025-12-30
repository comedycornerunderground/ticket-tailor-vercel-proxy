// api/cron-weekly-schedule.js
// Weekly cron job to post schedule to Slack channel
// Triggered every Monday at 9am UTC

import { getEventsForWeek } from './lib/event-fetcher.js';
import { formatWeeklySchedule, getAvailableSlots } from './lib/schedule-formatter.js';
import { postMessage } from './lib/slack-client.js';
import { generateScheduleId, storeSchedulePost } from './lib/schedule-store.js';

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
      const availableSlots = getAvailableSlots(events, {});

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
