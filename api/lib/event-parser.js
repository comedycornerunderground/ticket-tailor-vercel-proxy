// api/lib/event-parser.js
// Parse event names to determine show type (showcase vs no-showcase)

/**
 * Parse a show name to determine if it has showcase slots available
 *
 * Rules:
 * - "with" in name → showcase slots available (e.g., "Performer 1 with Performer 2")
 * - "and" in name → no showcase slots (e.g., "Performer 1 and Performer 2")
 * - Special events like "Midweek Madness Mic", "Open Mic" → showcase available
 * - TBD/Show? → showcase available (TBD shows need staff)
 *
 * @param {string} name - The event name
 * @returns {{ type: 'showcase' | 'no-showcase' | 'special', performers: string[], isOpenMic: boolean, isMidweekMic: boolean, isTBD: boolean }}
 */
export function parseShowName(name) {
  if (!name) {
    return { type: 'showcase', performers: [], isOpenMic: false, isMidweekMic: false, isTBD: true };
  }

  const lowerName = name.toLowerCase().trim();

  // Check for special event types first
  const isOpenMic = lowerName.includes('open mic');
  const isMidweekMic = lowerName.includes('midweek madness');
  const isTBD = lowerName.includes('show?') || lowerName === 'tbd' || lowerName === 'tba';

  // Special events always have showcase slots
  if (isMidweekMic || isTBD) {
    return { type: 'special', performers: [], isOpenMic, isMidweekMic, isTBD };
  }

  // Check for "with" pattern (showcase available)
  // Match pattern: "Performer 1 with Performer 2"
  const withMatch = name.match(/^(.+?)\s+with\s+(.+)$/i);
  if (withMatch) {
    return {
      type: 'showcase',
      performers: [withMatch[1].trim(), withMatch[2].trim()],
      isOpenMic,
      isMidweekMic,
      isTBD
    };
  }

  // Check for "and" pattern (no showcase)
  // Match pattern: "Performer 1 and Performer 2" or "Performer 1 and Friends"
  const andMatch = name.match(/^(.+?)\s+and\s+(.+)$/i);
  if (andMatch) {
    return {
      type: 'no-showcase',
      performers: [andMatch[1].trim(), andMatch[2].trim()],
      isOpenMic,
      isMidweekMic,
      isTBD
    };
  }

  // Default: single performer or unknown format - assume showcase available
  return {
    type: 'showcase',
    performers: name ? [name.trim()] : [],
    isOpenMic,
    isMidweekMic,
    isTBD
  };
}

/**
 * Check if any events in a list have showcase slots available
 * @param {Array<{name: string}>} events - Array of events with name property
 * @returns {boolean}
 */
export function hasShowcaseSlots(events) {
  return events.some(event => {
    const parsed = parseShowName(event.name);
    return parsed.type === 'showcase' || parsed.type === 'special';
  });
}

/**
 * Format show name for display, indicating showcase availability
 * @param {string} name - The event name
 * @returns {string}
 */
export function formatShowName(name) {
  const parsed = parseShowName(name);

  if (parsed.isTBD) {
    return 'TBD';
  }

  return name;
}
