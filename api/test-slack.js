// api/test-slack.js
// Simple test endpoint to verify Slack connection

import { postMessage } from './lib/slack-client.js';

export default async function handler(req, res) {
  try {
    const channel = process.env.WEEKLY_CHANNEL;

    if (!channel) {
      return res.status(500).json({ error: 'WEEKLY_CHANNEL not configured' });
    }

    const result = await postMessage(
      channel,
      'Test message from CCUG Schedule Bot - Slack integration is working!'
    );

    return res.status(200).json({
      success: true,
      message: 'Test message sent!',
      channel,
      timestamp: result.ts
    });

  } catch (error) {
    console.error('Test error:', error);
    return res.status(500).json({
      error: 'Failed to send test message',
      message: error.message
    });
  }
}
