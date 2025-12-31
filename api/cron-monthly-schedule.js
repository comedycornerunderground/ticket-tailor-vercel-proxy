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
  // Allow ?test=true for manual testing
  const authHeader = req.headers.authorization;
  const isTest = req.query.test === 'true';

  if (!isTest && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // Channel 1 includes Wednesday shows + Friday Open Mic, Channel 2 is Fri/Sat only
    const eventsWithWed = await getEventsForUpcomingMonth({ includeWednesdays: true, includeFridayOpenMic: true });
    const eventsFriSat = await getEventsForUpcomingMonth({ includeWednesdays: false, includeFridayOpenMic: false });

    console.log(`Found ${eventsWithWed.length} events (with Wed) and ${eventsFriSat.length} events (Fri/Sat) for ${monthInfo.month} ${monthInfo.year}`);

    if (eventsWithWed.length === 0 && eventsFriSat.length === 0) {
      console.log('No events found for next month');
      return res.status(200).json({
        success: true,
        message: 'No events found for next month',
        month: monthInfo.month
      });
    }

    // Generate separate schedule IDs for each channel (independent sign-ups)
    const period = `${monthInfo.year}-${String(monthInfo.monthNum).padStart(2, '0')}`;
    const scheduleId1 = generateScheduleId('monthly', `${period}-ch1`);
    const scheduleId2 = generateScheduleId('monthly', `${period}-ch2`);

    // Channel 1: includes Wednesday shows
    const availableSlots1 = getAvailableSlots(eventsWithWed, {});
    const eventData1 = eventsWithWed.map(e => ({
      id: e.id,
      name: e.name,
      date: e.date,
      unix: e.unix
    }));

    // Channel 2: Fri/Sat only
    const availableSlots2 = getAvailableSlots(eventsFriSat, {});
    const eventData2 = eventsFriSat.map(e => ({
      id: e.id,
      name: e.name,
      date: e.date,
      unix: e.unix
    }));

    // Post to channel 1 with Wednesday shows included
    console.log(`Posting to channel 1: ${channel1} (with Wednesdays)`);
    const { text: text1, blocks: blocks1 } = formatMonthlySchedule(
      monthInfo.month,
      eventsWithWed,
      {},
      scheduleId1
    );
    const result1 = await postMessage(channel1, text1, blocks1);
    if (result1.ok) {
      await storeSchedulePost(scheduleId1, {
        type: 'monthly',
        period,
        month: monthInfo.month,
        year: monthInfo.year,
        channel: channel1,
        ts: result1.ts,
        events: eventData1,
        slots: availableSlots1,
        assignments: {}
      });
      console.log(`Posted to channel 1, ts: ${result1.ts}`);
    }

    // Post to channel 2 with Fri/Sat only
    console.log(`Posting to channel 2: ${channel2} (Fri/Sat only)`);
    const { text: text2, blocks: blocks2 } = formatMonthlySchedule(
      monthInfo.month,
      eventsFriSat,
      {},
      scheduleId2
    );
    const result2 = await postMessage(channel2, text2, blocks2);
    if (result2.ok) {
      await storeSchedulePost(scheduleId2, {
        type: 'monthly',
        period,
        month: monthInfo.month,
        year: monthInfo.year,
        channel: channel2,
        ts: result2.ts,
        events: eventData2,
        slots: availableSlots2,
        assignments: {}
      });
      console.log(`Posted to channel 2, ts: ${result2.ts}`);
    }

    console.log('Monthly schedule posted successfully');

    return res.status(200).json({
      success: true,
      scheduleId1,
      scheduleId2,
      month: monthInfo.month,
      year: monthInfo.year,
      channel1EventCount: eventsWithWed.length,
      channel2EventCount: eventsFriSat.length,
      channel1SlotCount: availableSlots1.length,
      channel2SlotCount: availableSlots2.length
    });

  } catch (error) {
    console.error('Monthly cron error:', error);
    return res.status(500).json({
      error: 'Failed to post monthly schedule',
      message: error.message
    });
  }
}
