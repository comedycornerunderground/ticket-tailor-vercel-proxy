// api/debug-weekly.js
// Debug endpoint to see what events will be posted

import { getEventsForWeek } from './lib/event-fetcher.js';
import { parseShowName } from './lib/event-parser.js';

function getDayFromISODate(isoDate) {
  const datePart = isoDate.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0);
  return localDate.getDay();
}

export default async function handler(req, res) {
  try {
    const events = await getEventsForWeek();

    const debugInfo = events.map(event => ({
      name: event.name,
      date: event.date,
      localDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][getDayFromISODate(event.date)],
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
