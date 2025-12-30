// api/test-slack.js
// Simple test endpoint to verify Slack connection

import { postMessage } from './lib/slack-client.js';

export default async function handler(req, res) {
  try {
    const channels = [
      { name: 'MONTHLY_CHANNEL_1', id: process.env.MONTHLY_CHANNEL_1 },
      { name: 'MONTHLY_CHANNEL_2', id: process.env.MONTHLY_CHANNEL_2 },
      { name: 'WEEKLY_CHANNEL', id: process.env.WEEKLY_CHANNEL }
    ];

    const results = [];

    for (const channel of channels) {
      if (!channel.id) {
        results.push({ name: channel.name, error: 'Not configured' });
        continue;
      }

      try {
        const result = await postMessage(
          channel.id,
          `Test message from CCUG Schedule Bot - ${channel.name} is working!`
        );
        results.push({ name: channel.name, channel: channel.id, success: true, ts: result.ts });
      } catch (err) {
        results.push({ name: channel.name, channel: channel.id, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      results
    });

  } catch (error) {
    console.error('Test error:', error);
    return res.status(500).json({
      error: 'Failed to send test messages',
      message: error.message
    });
  }
}
