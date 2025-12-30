// api/lib/slack-client.js
// Slack API wrapper for posting and updating messages

import { WebClient } from '@slack/web-api';
import crypto from 'crypto';

let slackClient = null;

/**
 * Get or create Slack WebClient instance
 * @returns {WebClient}
 */
export function getSlackClient() {
  if (!slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN not configured');
    }
    slackClient = new WebClient(token);
  }
  return slackClient;
}

/**
 * Verify Slack request signature
 * @param {string} signature - X-Slack-Signature header
 * @param {string} timestamp - X-Slack-Request-Timestamp header
 * @param {string} body - Raw request body
 * @returns {boolean}
 */
export function verifySlackSignature(signature, timestamp, body) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET not configured');
    return false;
  }

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    console.error('Slack request timestamp too old');
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

/**
 * Post a message to a Slack channel
 * @param {string} channel - Channel ID
 * @param {string} text - Message text (fallback for notifications)
 * @param {Array} blocks - Slack Block Kit blocks
 * @returns {Promise<{ok: boolean, ts: string, channel: string}>}
 */
export async function postMessage(channel, text, blocks = null) {
  const client = getSlackClient();

  const payload = {
    channel,
    text
  };

  if (blocks) {
    payload.blocks = blocks;
  }

  const result = await client.chat.postMessage(payload);
  return {
    ok: result.ok,
    ts: result.ts,
    channel: result.channel
  };
}

/**
 * Update an existing Slack message
 * @param {string} channel - Channel ID
 * @param {string} ts - Message timestamp
 * @param {string} text - New message text
 * @param {Array} blocks - New Slack Block Kit blocks
 * @returns {Promise<{ok: boolean}>}
 */
export async function updateMessage(channel, ts, text, blocks = null) {
  const client = getSlackClient();

  const payload = {
    channel,
    ts,
    text
  };

  if (blocks) {
    payload.blocks = blocks;
  }

  const result = await client.chat.update(payload);
  return { ok: result.ok };
}

/**
 * Open a modal dialog
 * @param {string} triggerId - Trigger ID from interaction payload
 * @param {object} view - Modal view definition
 * @returns {Promise<{ok: boolean}>}
 */
export async function openModal(triggerId, view) {
  const client = getSlackClient();

  const result = await client.views.open({
    trigger_id: triggerId,
    view
  });

  return { ok: result.ok };
}

/**
 * Get user info by ID
 * @param {string} userId - Slack user ID
 * @returns {Promise<{name: string, realName: string}>}
 */
export async function getUserInfo(userId) {
  const client = getSlackClient();

  const result = await client.users.info({ user: userId });

  return {
    name: result.user.name,
    realName: result.user.real_name || result.user.name
  };
}
