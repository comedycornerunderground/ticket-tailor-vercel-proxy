// api/debug-weekly.js
// Debug endpoint to see what events will be posted

import { getEventsForWeek } from './lib/event-fetcher.js';
import { parseShowName } from './lib/event-parser.js';

export default async function handler(req, res) {
  try {
    const events = await getEventsForWeek();

    const debugInfo = events.map(event => ({
      name: event.name,
      date: event.date,
      day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][event.dateObj.getDay()],
      parsed: parseShowName(event.name)
    }));

    return res.status(200).json({
      count: events.length,
      events: debugInfo
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
