// api/slack-interactivity.js
// Handle Slack interactive components (buttons, modals)

import {
  verifySlackSignature,
  openModal,
  updateMessage,
  getUserInfo
} from './lib/slack-client.js';
import {
  buildSlotSelectionModal,
  formatMonthlySchedule,
  formatWeeklySchedule
} from './lib/schedule-formatter.js';
import {
  getSchedule,
  assignSlot,
  getDisplayAssignments
} from './lib/schedule-store.js';

export const config = {
  api: {
    bodyParser: false, // Need raw body for signature verification
  },
};

/**
 * Parse raw body from request
 */
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Rebuild and update the schedule message after assignment changes
 */
async function updateScheduleMessage(schedule) {
  const assignments = getDisplayAssignments(schedule.assignments);

  let newText, newBlocks;

  if (schedule.type === 'monthly') {
    const result = formatMonthlySchedule(
      schedule.month,
      schedule.events.map(e => ({
        ...e,
        dateObj: new Date(e.unix * 1000)
      })),
      assignments,
      schedule.id || `schedule:${schedule.type}:${schedule.period}`
    );
    newText = result.text;
    newBlocks = result.blocks;
  } else {
    const result = formatWeeklySchedule(
      schedule.events.map(e => ({
        ...e,
        dateObj: new Date(e.unix * 1000)
      })),
      assignments,
      schedule.id || `schedule:${schedule.type}:${schedule.period}`
    );
    newText = result.text;
    newBlocks = result.blocks;
  }

  // Update all messages (could be multiple channels for monthly)
  if (schedule.messages && schedule.messages.length > 0) {
    for (const msg of schedule.messages) {
      await updateMessage(msg.channel, msg.ts, newText, newBlocks);
    }
  } else if (schedule.channel && schedule.ts) {
    await updateMessage(schedule.channel, schedule.ts, newText, newBlocks);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req);

    // Verify Slack signature
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];

    if (!verifySlackSignature(signature, timestamp, rawBody)) {
      console.error('Invalid Slack signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse the payload
    const params = new URLSearchParams(rawBody);
    const payload = JSON.parse(params.get('payload'));

    console.log('Received interaction type:', payload.type);

    // Handle different interaction types
    if (payload.type === 'block_actions') {
      return await handleBlockAction(payload, res);
    } else if (payload.type === 'view_submission') {
      return await handleViewSubmission(payload, res);
    }

    // Unknown interaction type
    console.log('Unknown interaction type:', payload.type);
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Interactivity error:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Handle button clicks
 */
async function handleBlockAction(payload, res) {
  const action = payload.actions[0];

  if (action.action_id === 'claim_shift') {
    const scheduleId = action.value;
    console.log('Claim shift button clicked for schedule:', scheduleId);

    // Get schedule from store
    const schedule = await getSchedule(scheduleId);

    if (!schedule) {
      console.error('Schedule not found:', scheduleId);
      return res.status(200).json({
        response_action: 'errors',
        errors: { general: 'Schedule not found' }
      });
    }

    // Build available slots
    const assignments = getDisplayAssignments(schedule.assignments);
    const availableSlots = schedule.slots.map(slot => ({
      ...slot,
      claimed: !!assignments[slot.dateKey],
      claimedBy: assignments[slot.dateKey] || null
    }));

    // Open modal with slot selection
    const modal = buildSlotSelectionModal(scheduleId, availableSlots);

    await openModal(payload.trigger_id, modal);

    return res.status(200).json({ ok: true });
  }

  // Unknown action
  console.log('Unknown action:', action.action_id);
  return res.status(200).json({ ok: true });
}

/**
 * Handle modal submissions
 */
async function handleViewSubmission(payload, res) {
  if (payload.view.callback_id === 'shift_selection_modal') {
    const scheduleId = payload.view.private_metadata;
    const userId = payload.user.id;

    console.log('Shift selection submitted for schedule:', scheduleId);

    // Get selected shifts
    const selectedShifts = payload.view.state.values.shift_selection.selected_shifts.selected_options || [];

    if (selectedShifts.length === 0) {
      return res.status(200).json({
        response_action: 'errors',
        errors: {
          shift_selection: 'Please select at least one shift'
        }
      });
    }

    // Get user info
    const userInfo = await getUserInfo(userId);
    const userName = userInfo.realName || userInfo.name;

    // Get schedule
    const schedule = await getSchedule(scheduleId);

    if (!schedule) {
      console.error('Schedule not found:', scheduleId);
      return res.status(200).json({
        response_action: 'errors',
        errors: { general: 'Schedule not found' }
      });
    }

    // Assign each selected shift
    let updatedSchedule = schedule;
    for (const option of selectedShifts) {
      const dateKey = option.value;
      console.log(`Assigning ${userName} to ${dateKey}`);
      updatedSchedule = await assignSlot(scheduleId, dateKey, userName, userId);
    }

    // Update the original message with new assignments
    await updateScheduleMessage({
      ...updatedSchedule,
      id: scheduleId
    });

    console.log('Shifts assigned and message updated');

    // Close modal
    return res.status(200).json({
      response_action: 'clear'
    });
  }

  // Unknown view
  console.log('Unknown view callback_id:', payload.view.callback_id);
  return res.status(200).json({ ok: true });
}
