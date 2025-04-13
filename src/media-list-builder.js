import chalk from 'chalk';
import apiRequest, { handleResponse } from './request';
import db from './db';

/**
 * Sanatizes a string for writing to disk. Removes illegal characters in Windows, Linux, and OSX.
 * Useful for file, folder, and user names.
 * @param {string} string
 */
function sanitizeString(string) {
  return string
    .trim()
    .replace(' ', '-')
    .replace(/([<|>|:|"|\/|\|||\?|\*\]|&])/g, '_');
}

/**
 * Shrink the data down to only what's necessary: Photo URL's and user names.
 *
 * @param  {Array} media Array of gallery photo objects from the API
 * @return {Array} Array of objects containing photo URL and user's name
 */
function mappedMediaObjects(mediaObjects) {
  return mediaObjects.map((media) => ({
    url: media.attachments[0].url,
    user: media.name ? sanitizeString(media.name) : 'UnknownUser',
    created: media.created_at,
  }));
}

/**
 * Connect to a given group's gallery and recursively
 * build up an array of downloadable media URL's
 *
 * @param  {String} token GroupMe Developer Token ID
 * @param  {Integer} groupId GroupMe Conversation ID
 * @return {Promise}
 */
export async function mediaListBuilder(token, groupId) {
  if (!token || !groupId) {
    throw new Error('Token and groupId are required');
  }

  try {
    // Get group info first
    const groupResponse = await apiRequest(token, `groups/${groupId}`);
    const groupData = await groupResponse.json();
    const groupName = groupData.response.name;

    let allMedia = [];
    let beforeId = null;
    let hasMore = true;
    let downloadUrls = new Set();

    while (hasMore) {
      const endpoint = beforeId 
        ? `groups/${groupId}/messages?limit=100&before_id=${beforeId}`
        : `groups/${groupId}/messages?limit=100`;

      const response = await apiRequest(token, endpoint);
      
      // Handle both 200 and 304 responses
      if (response.status !== 200 && response.status !== 304) {
        if (response.status === 401) {
          throw new Error('Invalid or expired token');
        }
        throw new Error(`API request failed with status ${response.status}`);
      }

      // For 304, treat as if we got the same data again
      const data = response.status === 304 ? { response: { messages: [] } } : await response.json();
      const messages = data.response.messages;

      if (!messages || messages.length === 0) {
        hasMore = false;
        continue;
      }

      messages.forEach(msg => {
        if (msg.attachments) {
          msg.attachments
            .filter(att => att.type === 'image')
            .forEach(att => {
              if (!downloadUrls.has(att.url)) {
                downloadUrls.add(att.url);
                allMedia.push({
                  url: att.url,
                  messageId: msg.id,
                  user: msg.name ? sanitizeString(msg.name) : 'UnknownUser',
                  created: msg.created_at
                });
              }
            });
        }
      });

      beforeId = messages[messages.length - 1].id;
    }

    return {
      groupId,
      groupName: sanitizeString(groupName),
      media: allMedia,
      token
    };
  } catch (error) {
    // Improve error message
    const message = error.message.includes('status') 
      ? error.message 
      : `Failed to build media list: ${error.message}`;
    throw new Error(message);
  }
}
