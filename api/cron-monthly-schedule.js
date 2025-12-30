// api/cron-monthly-schedule.js
// Monthly cron job to post schedule to Slack channels
// Triggered on the 1st of each month at 9am UTC

import { getEventsForUpcomingMonth, getNextMonthInfo } from './lib/event-fetcher.js';
import { formatMonthlySchedule, getAvailableSlots } from './lib/schedule-formatter.js';
import { postMessage } from './lib/slack-client.js';
import {
  generateScheduleId,
  storeSchedulePost,
  storeMultiChannelPost
} from './lib/schedule-store.js';

export default async function handler(req, res) {
  // Verify this is a cron job request (Vercel adds this header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow manual triggering for testing if CRON_SECRET not set
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('Starting monthly schedule cron...');

    // Get channel IDs from environment
    const channel1 = process.env.MONTHLY_CHANNEL_1;
    const channel2 = process.env.MONTHLY_CHANNEL_2;

    if (!channel1 || !channel2) {
      throw new Error('MONTHLY_CHANNEL_1 or MONTHLY_CHANNEL_2 not configured');
    }

    // Get next month's events
    const monthInfo = getNextMonthInfo();
    const events = await getEventsForUpcomingMonth();

    console.log(`Found ${events.length} events for ${monthInfo.month} ${monthInfo.year}`);

    if (events.length === 0) {
      console.log('No events found for next month');
      return res.status(200).json({
        success: true,
        message: 'No events found for next month',
        month: monthInfo.month
      });
    }

    // Generate schedule ID
    const period = `${monthInfo.year}-${String(monthInfo.monthNum).padStart(2, '0')}`;
    const scheduleId = generateScheduleId('monthly', period);

    // Format the schedule
    const { text, blocks } = formatMonthlySchedule(
      monthInfo.month,
      events,
      {}, // No assignments yet
      scheduleId
    );

    // Post to both channels
    const postedMessages = [];

    console.log(`Posting to channel 1: ${channel1}`);
    const result1 = await postMessage(channel1, text, blocks);
    if (result1.ok) {
      postedMessages.push({ channel: channel1, ts: result1.ts });
      console.log(`Posted to channel 1, ts: ${result1.ts}`);
    }

    console.log(`Posting to channel 2: ${channel2}`);
    const result2 = await postMessage(channel2, text, blocks);
    if (result2.ok) {
      postedMessages.push({ channel: channel2, ts: result2.ts });
      console.log(`Posted to channel 2, ts: ${result2.ts}`);
    }

    // Store schedule info
    const availableSlots = getAvailableSlots(events, {});

    await storeSchedulePost(scheduleId, {
      type: 'monthly',
      period,
      month: monthInfo.month,
      year: monthInfo.year,
      channel: channel1, // Primary channel
      ts: result1.ts,
      events: events.map(e => ({
        id: e.id,
        name: e.name,
        date: e.date,
        unix: e.unix
      })),
      slots: availableSlots,
      assignments: {}
    });

    // Store multi-channel info
    await storeMultiChannelPost(scheduleId, postedMessages);

    console.log('Monthly schedule posted successfully');

    return res.status(200).json({
      success: true,
      scheduleId,
      month: monthInfo.month,
      year: monthInfo.year,
      eventCount: events.length,
      slotCount: availableSlots.length,
      channels: postedMessages.length
    });

  } catch (error) {
    console.error('Monthly cron error:', error);
    return res.status(500).json({
      error: 'Failed to post monthly schedule',
      message: error.message
    });
  }
}
