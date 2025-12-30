// api/lib/schedule-store.js
// Vercel KV operations for schedule storage

import { kv } from '@vercel/kv';

/**
 * Generate a unique schedule ID
 * @param {string} type - 'monthly' or 'weekly'
 * @param {string} period - e.g., '2025-01' for monthly or '2025-01-06' for weekly
 * @returns {string}
 */
export function generateScheduleId(type, period) {
  return `schedule:${type}:${period}`;
}

/**
 * Store a new schedule post
 * @param {string} scheduleId - Unique schedule ID
 * @param {object} data - Schedule data
 * @param {string} data.channel - Slack channel ID
 * @param {string} data.ts - Slack message timestamp
 * @param {string} data.type - 'monthly' or 'weekly'
 * @param {string} data.period - Period identifier
 * @param {Array} data.events - Events in this schedule
 * @param {object} data.assignments - Initial assignments (empty object)
 */
export async function storeSchedulePost(scheduleId, data) {
  await kv.set(scheduleId, {
    ...data,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  // Also store in a list of active schedules for this channel
  const channelKey = `channel:${data.channel}:schedules`;
  const existing = await kv.lrange(channelKey, 0, -1) || [];
  if (!existing.includes(scheduleId)) {
    await kv.lpush(channelKey, scheduleId);
  }
}

/**
 * Get a schedule by ID
 * @param {string} scheduleId
 * @returns {Promise<object|null>}
 */
export async function getSchedule(scheduleId) {
  return await kv.get(scheduleId);
}

/**
 * Update assignments for a schedule
 * @param {string} scheduleId
 * @param {object} assignments - Map of dateKey to assignee name
 */
export async function updateAssignments(scheduleId, assignments) {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`);
  }

  schedule.assignments = assignments;
  schedule.updatedAt = Date.now();

  await kv.set(scheduleId, schedule);
}

/**
 * Assign a user to a specific slot (supports multiple people per slot)
 * @param {string} scheduleId
 * @param {string} dateKey - e.g., "1/7"
 * @param {string} userName - User's display name
 * @param {string} userId - Slack user ID
 */
export async function assignSlot(scheduleId, dateKey, userName, userId) {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`);
  }

  if (!schedule.assignments) {
    schedule.assignments = {};
  }

  // Support multiple people per slot (stored as array)
  if (!schedule.assignments[dateKey]) {
    schedule.assignments[dateKey] = [];
  }

  // Check if user already signed up for this slot
  const existingIndex = schedule.assignments[dateKey].findIndex(a => a.userId === userId);
  if (existingIndex === -1) {
    schedule.assignments[dateKey].push({
      name: userName,
      userId: userId,
      assignedAt: Date.now()
    });
  }

  schedule.updatedAt = Date.now();

  await kv.set(scheduleId, schedule);

  return schedule;
}

/**
 * Remove assignment from a slot
 * @param {string} scheduleId
 * @param {string} dateKey
 */
export async function unassignSlot(scheduleId, dateKey) {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`);
  }

  if (schedule.assignments && schedule.assignments[dateKey]) {
    delete schedule.assignments[dateKey];
    schedule.updatedAt = Date.now();
    await kv.set(scheduleId, schedule);
  }

  return schedule;
}

/**
 * Get all active schedules for a channel
 * @param {string} channel - Slack channel ID
 * @returns {Promise<Array>}
 */
export async function getChannelSchedules(channel) {
  const channelKey = `channel:${channel}:schedules`;
  const scheduleIds = await kv.lrange(channelKey, 0, -1) || [];

  const schedules = [];
  for (const id of scheduleIds) {
    const schedule = await getSchedule(id);
    if (schedule) {
      schedules.push({ id, ...schedule });
    }
  }

  return schedules;
}

/**
 * Get the most recent schedule for a channel
 * @param {string} channel - Slack channel ID
 * @returns {Promise<object|null>}
 */
export async function getLatestSchedule(channel) {
  const schedules = await getChannelSchedules(channel);
  if (schedules.length === 0) return null;

  // Sort by createdAt descending
  schedules.sort((a, b) => b.createdAt - a.createdAt);
  return schedules[0];
}

/**
 * Store message info for multiple channels (for monthly posts to 2 channels)
 * @param {string} scheduleId
 * @param {Array<{channel: string, ts: string}>} messages - Posted messages
 */
export async function storeMultiChannelPost(scheduleId, messages) {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    throw new Error(`Schedule not found: ${scheduleId}`);
  }

  schedule.messages = messages;
  schedule.updatedAt = Date.now();

  await kv.set(scheduleId, schedule);

  // Update channel lists
  for (const msg of messages) {
    const channelKey = `channel:${msg.channel}:schedules`;
    const existing = await kv.lrange(channelKey, 0, -1) || [];
    if (!existing.includes(scheduleId)) {
      await kv.lpush(channelKey, scheduleId);
    }
  }
}

/**
 * Get formatted assignments for display (with Slack user mentions)
 * @param {object} assignments - Raw assignments object
 * @returns {object} - Map of dateKey to Slack mentions (comma-separated)
 */
export function getDisplayAssignments(assignments) {
  if (!assignments) return {};

  const display = {};
  for (const [dateKey, value] of Object.entries(assignments)) {
    if (Array.isArray(value)) {
      // Multiple people per slot - use Slack mention format <@USER_ID>
      display[dateKey] = value.map(a => a.userId ? `<@${a.userId}>` : a.name).join(', ');
    } else if (typeof value === 'string') {
      display[dateKey] = value;
    } else if (value && value.userId) {
      display[dateKey] = `<@${value.userId}>`;
    } else if (value && value.name) {
      display[dateKey] = value.name;
    }
  }
  return display;
}
