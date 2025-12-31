// api/lib/event-fetcher.js
// Fetch events from Ticket Tailor API with date filtering

const BASE_URL = 'https://api.tickettailor.com/v1';

/**
 * Get authorization headers for Ticket Tailor API
 * @returns {object}
 */
function getHeaders() {
  const API_KEY = process.env.TT_API_KEY;
  if (!API_KEY) {
    throw new Error('TT_API_KEY not configured');
  }
  return {
    'Authorization': `Basic ${Buffer.from(API_KEY + ':').toString('base64')}`,
    'Accept': 'application/json'
  };
}

/**
 * Fetch all events from Ticket Tailor (with pagination)
 * @returns {Promise<Array>}
 */
async function fetchAllEvents() {
  const headers = getHeaders();
  const allEvents = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Fetch all event series (with pagination)
  const allSeries = [];
  let seriesUrl = `${BASE_URL}/event_series`;

  while (seriesUrl) {
    const seriesRes = await fetch(seriesUrl, { headers });
    if (!seriesRes.ok) break;

    const seriesData = await seriesRes.json();
    const seriesPage = Array.isArray(seriesData.data) ? seriesData.data : [];
    allSeries.push(...seriesPage);

    if (seriesData.links && seriesData.links.next) {
      seriesUrl = BASE_URL + seriesData.links.next;
    } else {
      seriesUrl = null;
    }
  }

  // 2. For each series, fetch its occurrences
  for (const series of allSeries) {
    if (series.upcoming_occurrences === 0) continue;

    let occUrl = `${BASE_URL}/event_series/${series.id}/events`;

    while (occUrl) {
      const occRes = await fetch(occUrl, { headers });
      if (!occRes.ok) break;

      const occData = await occRes.json();
      const occurrences = Array.isArray(occData.data) ? occData.data : [];

      occurrences.forEach(occ => {
        if (occ.start && occ.start.unix) {
          const eventDate = new Date(occ.start.unix * 1000);

          if (eventDate >= today && occ.tickets_available) {
            allEvents.push({
              id: occ.id,
              seriesId: series.id,
              name: series.name,
              date: occ.start.iso,
              unix: occ.start.unix,
              dateObj: eventDate,
              image: series.images?.thumbnail || series.images?.header || null
            });
          }
        }
      });

      if (occData.links && occData.links.next) {
        occUrl = BASE_URL + occData.links.next;
      } else {
        occUrl = null;
      }
    }
  }

  // 3. Fetch standalone events
  let eventsUrl = `${BASE_URL}/events`;

  while (eventsUrl) {
    const eventsRes = await fetch(eventsUrl, { headers });
    if (!eventsRes.ok) break;

    const eventsData = await eventsRes.json();
    const events = Array.isArray(eventsData.data) ? eventsData.data : [];

    events.forEach(event => {
      if (event.start && event.start.unix && !event.event_series_id) {
        const eventDate = new Date(event.start.unix * 1000);

        if (eventDate >= today && event.tickets_available) {
          allEvents.push({
            id: event.id,
            seriesId: null,
            name: event.name,
            date: event.start.iso,
            unix: event.start.unix,
            dateObj: eventDate,
            image: event.images?.thumbnail || event.images?.header || null
          });
        }
      }
    });

    if (eventsData.links && eventsData.links.next) {
      eventsUrl = BASE_URL + eventsData.links.next;
    } else {
      eventsUrl = null;
    }
  }

  // Sort by date
  allEvents.sort((a, b) => a.unix - b.unix);
  return allEvents;
}

/**
 * Get events for a specific month
 * @param {number} month - Month (1-12)
 * @param {number} year - Year (e.g., 2025)
 * @returns {Promise<Array>}
 */
export async function getEventsForMonth(month, year) {
  const allEvents = await fetchAllEvents();

  // Filter to the specific month
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  return allEvents.filter(event => {
    return event.dateObj >= startOfMonth && event.dateObj <= endOfMonth;
  });
}

/**
 * Get events for the next N days starting from a date
 * @param {Date} startDate - Start date (defaults to today)
 * @param {number} days - Number of days (defaults to 7)
 * @returns {Promise<Array>}
 */
export async function getEventsForDays(startDate = new Date(), days = 7) {
  const allEvents = await fetchAllEvents();

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + days);
  end.setHours(23, 59, 59, 999);

  return allEvents.filter(event => {
    return event.dateObj >= start && event.dateObj <= end;
  });
}

/**
 * Get the day of week from an ISO date string (respects local timezone)
 * @param {string} isoDate - ISO date string like "2026-01-02T20:00:00-06:00"
 * @returns {number} - Day of week (0=Sun, 1=Mon, ... 4=Thu, 5=Fri, 6=Sat)
 */
function getDayFromISODate(isoDate) {
  // Extract just the date part (YYYY-MM-DD) to avoid timezone issues
  const datePart = isoDate.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  // Create date at noon to avoid any DST issues
  const localDate = new Date(year, month - 1, day, 12, 0, 0);
  return localDate.getDay();
}

/**
 * Get events for the upcoming week (7 days), excluding Thursdays and Open Mics
 * @returns {Promise<Array>}
 */
export async function getEventsForWeek() {
  const events = await getEventsForDays(new Date(), 7);
  return events.filter(event => {
    // Skip Open Mic events
    if (event.name.toLowerCase().includes('open mic')) {
      return false;
    }
    // Skip Thursdays (day 4) - they're booked separately
    // Use the ISO date string to get correct local day
    const day = getDayFromISODate(event.date);
    if (day === 4) {
      return false;
    }
    return true;
  });
}

/**
 * Get events for the upcoming month (from today), with filtering options
 * @param {object} options - Filter options
 * @param {boolean} options.includeWednesdays - Include Wednesday shows (default false)
 * @param {boolean} options.includeFridayOpenMic - Include Friday Open Mic (default false)
 * @returns {Promise<Array>}
 */
export async function getEventsForUpcomingMonth(options = {}) {
  const { includeWednesdays = false, includeFridayOpenMic = false } = options;

  const today = new Date();
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const events = await getEventsForMonth(nextMonth.getMonth() + 1, nextMonth.getFullYear());

  return events.filter(event => {
    const isOpenMic = event.name.toLowerCase().includes('open mic');
    const isFridayOpenMic = isOpenMic && event.name.toLowerCase().includes('friday');
    const day = getDayFromISODate(event.date);

    // Skip Thursday Open Mics always
    if (isOpenMic && !isFridayOpenMic) {
      return false;
    }
    // Skip Friday Open Mic unless explicitly included
    if (isFridayOpenMic && !includeFridayOpenMic) {
      return false;
    }
    // Skip Thursdays (day 4) - they're booked separately
    if (day === 4) {
      return false;
    }
    // Skip Wednesdays (day 3) unless explicitly included
    if (day === 3 && !includeWednesdays) {
      return false;
    }
    return true;
  });
}

/**
 * Get the next month's name and year
 * @returns {{ month: string, year: number, monthNum: number }}
 */
export function getNextMonthInfo() {
  const today = new Date();
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  return {
    month: monthNames[nextMonth.getMonth()].toUpperCase(),
    year: nextMonth.getFullYear(),
    monthNum: nextMonth.getMonth() + 1
  };
}
