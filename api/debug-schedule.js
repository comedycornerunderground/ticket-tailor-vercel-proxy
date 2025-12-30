// api/debug-schedule.js
// Debug endpoint to check stored schedule

import { getSchedule } from './lib/schedule-store.js';

export default async function handler(req, res) {
  const scheduleId = req.query.id || 'schedule:monthly:2026-01';

  try {
    const schedule = await getSchedule(scheduleId);

    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found', scheduleId });
    }

    return res.status(200).json({
      scheduleId,
      hasSlots: !!schedule.slots,
      slotsCount: schedule.slots?.length || 0,
      hasAssignments: !!schedule.assignments,
      assignmentsCount: Object.keys(schedule.assignments || {}).length,
      keys: Object.keys(schedule),
      slots: schedule.slots?.slice(0, 3), // First 3 slots for preview
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
