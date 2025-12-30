// api/lib/schedule-formatter.js
// Format event schedules for Slack messages

import { parseShowName } from './event-parser.js';

/**
 * Format date for display (e.g., "1/7")
 * @param {Date} date
 * @returns {string}
 */
function formatDateShort(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Format time for display (e.g., "8pm")
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  let hours = date.getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours || 12;
  return `${hours}${ampm}`;
}

/**
 * Group events by date
 * @param {Array} events
 * @returns {Map<string, Array>}
 */
function groupEventsByDate(events) {
  const grouped = new Map();

  events.forEach(event => {
    const dateKey = formatDateShort(event.dateObj);
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

  const parts = events.map(event => {
    const time = formatTime(event.dateObj);
    const parsed = parseShowName(event.name);
    const displayName = parsed.isTBD ? 'TBD' : event.name;
    return `${time} ${displayName}`;
  });

  let line = `${dateKey} ${parts.join(' and ')}`;

  // Add assignee if present
  const slotKey = dateKey;
  if (assignments[slotKey]) {
    line += ` @${assignments[slotKey]}`;
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
        line += ` - @${assignee}`;
      } else {
        line += ' - AVAILABLE';
      }
    }

    lines.push(line);
  }

  // If no showcase slots this week
  if (!hasShowcase) {
    return {
      text: 'No showcase slots this week - all shows are "and" format',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*No showcase slots this week* - all shows are "and" format'
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

  return { text: scheduleText, blocks, hasShowcase: true };
}

/**
 * Build the slot selection modal
 * @param {string} scheduleId - Schedule ID
 * @param {Array} availableSlots - Array of { dateKey, eventName, claimed }
 * @returns {object} - Slack modal view
 */
export function buildSlotSelectionModal(scheduleId, availableSlots) {
  const options = availableSlots
    .filter(slot => !slot.claimed)
    .map(slot => ({
      text: {
        type: 'plain_text',
        text: `${slot.dateKey} - ${slot.eventName}`,
        emoji: true
      },
      value: slot.dateKey
    }));

  if (options.length === 0) {
    return {
      type: 'modal',
      title: {
        type: 'plain_text',
        text: 'No Available Shifts'
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
            text: 'All shifts have been claimed! Check back later or contact a coordinator.'
          }
        }
      ]
    };
  }

  return {
    type: 'modal',
    callback_id: 'shift_selection_modal',
    private_metadata: scheduleId,
    title: {
      type: 'plain_text',
      text: 'Claim Shifts'
    },
    submit: {
      type: 'plain_text',
      text: 'Claim Selected'
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
          text: 'Select the shift(s) you want to work:'
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
          text: 'Available Shifts',
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
