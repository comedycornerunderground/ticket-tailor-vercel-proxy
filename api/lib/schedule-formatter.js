// api/lib/schedule-formatter.js
// Format event schedules for Slack messages

import { parseShowName } from './event-parser.js';

/**
 * Format date for display (e.g., "1/7") from ISO string
 * Uses the date from the ISO string to avoid timezone issues
 * @param {string} isoDate - ISO date string like "2025-12-31T19:00:00-06:00"
 * @returns {string}
 */
function formatDateShort(isoDate) {
  // Extract just the date part (YYYY-MM-DD) to avoid timezone issues
  const datePart = isoDate.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  return `${month}/${day}`;
}


/**
 * Group events by date (using ISO string to avoid timezone issues)
 * @param {Array} events
 * @returns {Map<string, Array>}
 */
function groupEventsByDate(events) {
  const grouped = new Map();

  events.forEach(event => {
    const dateKey = formatDateShort(event.date);
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey).push(event);
  });

  return grouped;
}

/**
 * Format events for a single date into a line
 * @param {string} dateKey - e.g., "1/7"
 * @param {Array} events - Events on this date
 * @param {object} assignments - Map of slot IDs to assignee names
 * @returns {string}
 */
function formatDateLine(dateKey, events, assignments = {}) {
  // Sort events by time
  events.sort((a, b) => a.unix - b.unix);

  // Get unique event names for this date
  const uniqueNames = [...new Set(events.map(event => {
    const parsed = parseShowName(event.name);
    return parsed.isTBD ? 'TBD' : event.name;
  }))];

  let line = `${dateKey} ${uniqueNames.join(' / ')}`;

  // Add assignees if present (already formatted as Slack mentions)
  const slotKey = dateKey;
  if (assignments[slotKey]) {
    line += ` - ${assignments[slotKey]}`;
  }

  return line;
}

/**
 * Create Slack blocks for monthly schedule
 * @param {string} monthName - e.g., "JANUARY"
 * @param {Array} events - All events for the month
 * @param {object} assignments - Map of slot IDs to assignee names
 * @param {string} scheduleId - Unique schedule ID for button actions
 * @returns {{ text: string, blocks: Array }}
 */
export function formatMonthlySchedule(monthName, events, assignments = {}, scheduleId) {
  const grouped = groupEventsByDate(events);
  const lines = [];

  for (const [dateKey, dateEvents] of grouped) {
    lines.push(formatDateLine(dateKey, dateEvents, assignments));
  }

  const scheduleText = `${monthName} SCHEDULE\n${lines.join('\n')}`;

  // Create Slack blocks
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${monthName} SCHEDULE`,
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.join('\n')
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Click below to sign up for shifts:*'
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Claim Shift',
            emoji: true
          },
          style: 'primary',
          action_id: 'claim_shift',
          value: scheduleId
        }
      ]
    }
  ];

  return { text: scheduleText, blocks };
}

/**
 * Create Slack blocks for weekly schedule
 * @param {Array} events - Events for the week
 * @param {object} assignments - Map of slot IDs to assignee names
 * @param {string} scheduleId - Unique schedule ID for button actions
 * @returns {{ text: string, blocks: Array, hasShowcase: boolean }}
 */
export function formatWeeklySchedule(events, assignments = {}, scheduleId) {
  const grouped = groupEventsByDate(events);
  const lines = [];
  let hasShowcase = false;

  for (const [dateKey, dateEvents] of grouped) {
    // Check if any event on this date has showcase slots
    const dateHasShowcase = dateEvents.some(event => {
      const parsed = parseShowName(event.name);
      return parsed.type === 'showcase' || parsed.type === 'special';
    });

    if (dateHasShowcase) {
      hasShowcase = true;
    }

    const assignee = assignments[dateKey];
    let line = formatDateLine(dateKey, dateEvents, {});

    if (dateHasShowcase) {
      if (assignee) {
        line += ` - ${assignee}`;
      } else {
        line += ' - OPEN';
      }
    }

    lines.push(line);
  }

  // If no showcase slots this week
  if (!hasShowcase) {
    return {
      text: 'No slots this week',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*No slots this week*'
          }
        }
      ],
      hasShowcase: false
    };
  }

  const scheduleText = `WEEKLY SHIFTS AVAILABLE\n${lines.join('\n')}`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'WEEKLY SHIFTS AVAILABLE',
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.join('\n')
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_Click the button to mark yourself open for potential showcase slots. Admin will confirm assignments._'
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Mark open for slot',
            emoji: true
          },
          style: 'primary',
          action_id: 'claim_shift_weekly',
          value: scheduleId
        }
      ]
    }
  ];

  return { text: scheduleText, blocks, hasShowcase: true };
}

/**
 * Build the slot selection modal
 * @param {string} scheduleId - Schedule ID
 * @param {Array} availableSlots - Array of { dateKey, eventName, claimed }
 * @param {string} mode - 'weekly' or 'monthly'
 * @returns {object} - Slack modal view
 */
export function buildSlotSelectionModal(scheduleId, availableSlots, mode = 'monthly') {
  const options = availableSlots
    .filter(slot => !slot.claimed)
    .map(slot => {
      // Truncate event name to fit Slack's 75 char limit for option text
      let label = `${slot.dateKey} - ${slot.eventName}`;
      if (label.length > 75) {
        label = label.substring(0, 72) + '...';
      }
      return {
        text: {
          type: 'plain_text',
          text: label,
          emoji: true
        },
        value: slot.dateKey
      };
    });

  if (options.length === 0) {
    const message = mode === 'weekly'
      ? 'No showcase slots available this week.'
      : 'All shifts have been claimed! Check back later or contact a coordinator.';

    return {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'No Available Slots'
      },
      close: {
        type: 'plain_text',
        text: 'Close'
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message
          }
        }
      ]
    };
  }

  // Different text for weekly vs monthly
  const isWeekly = mode === 'weekly';
  const title = isWeekly ? 'Sign Up for Showcase' : 'Claim Shifts';
  const submitText = isWeekly ? 'Submit' : 'Claim Selected';
  const instructions = isWeekly
    ? '*Mark yourself as available for showcase slots.*\n\nSelect the dates you\'re interested in performing. An admin will review and confirm assignments.'
    : '*Claim your shift (first-come, first-served).*\n\nOnce you claim a shift, it\'s yours! Select the dates you want to work.';

  return {
    type: 'modal',
    callback_id: 'shift_selection_modal',
    private_metadata: JSON.stringify({ scheduleId, mode }),
    title: {
      type: 'plain_text',
      text: title
    },
    submit: {
      type: 'plain_text',
      text: submitText
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: instructions
        }
      },
      {
        type: 'input',
        block_id: 'shift_selection',
        element: {
          type: 'checkboxes',
          action_id: 'selected_shifts',
          options
        },
        label: {
          type: 'plain_text',
          text: isWeekly ? 'Available Dates' : 'Available Shifts',
          emoji: true
        }
      }
    ]
  };
}

/**
 * Get available slots from events
 * @param {Array} events - Events
 * @param {object} assignments - Current assignments
 * @returns {Array} - Array of { dateKey, eventName, claimed, claimedBy }
 */
export function getAvailableSlots(events, assignments = {}) {
  const grouped = groupEventsByDate(events);
  const slots = [];

  for (const [dateKey, dateEvents] of grouped) {
    // Check if any event on this date has showcase slots
    const showcaseEvents = dateEvents.filter(event => {
      const parsed = parseShowName(event.name);
      return parsed.type === 'showcase' || parsed.type === 'special';
    });

    if (showcaseEvents.length > 0) {
      const eventNames = showcaseEvents.map(e => e.name).join(' / ');
      const claimed = !!assignments[dateKey];

      slots.push({
        dateKey,
        eventName: eventNames,
        claimed,
        claimedBy: assignments[dateKey] || null
      });
    }
  }

  return slots;
}
