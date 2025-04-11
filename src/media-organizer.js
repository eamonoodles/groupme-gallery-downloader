// src/media-organizer.js
import path from 'path';
import fs from 'fs';
import { format } from 'date-fns';

/**
 * Determines the output path for a media file based on the organization method
 * 
 * @param {Object} options Configuration options
 * @param {String} options.baseDir Base output directory
 * @param {String} options.groupId Group ID
 * @param {String} options.method Organization method: 'flat', 'date', or 'user'
 * @param {Object} mediaItem Media item with metadata
 * @returns {String} Path where the file should be saved
 */
export function getOrganizedFilePath({ baseDir, groupId, method = 'flat' }, mediaItem) {
  const { user, created, url } = mediaItem;
  const createdDate = created ? new Date(created) : new Date();
  let outputDir = path.join(baseDir, groupId);
  
  switch (method.toLowerCase()) {
    case 'date':
      // Organize by Year/Month
      const year = format(createdDate, 'yyyy');
      const month = format(createdDate, 'MM-MMMM');
      outputDir = path.join(outputDir, year, month);
      break;
      
    case 'user':
      // Organize by user who posted
      const safeUsername = sanitizeString(user || 'unknown');
      outputDir = path.join(outputDir, safeUsername);
      break;
      
    case 'flat':
    default:
      // All files in one directory (default behavior)
      break;
  }
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate filename
  const fileName = generateFileName(mediaItem);
  
  return path.join(outputDir, fileName);
}

/**
 * Generate a filename based on customizable pattern or default pattern
 * 
 * @param {Object} mediaItem Media item with metadata
 * @param {String} pattern Optional filename pattern
 * @returns {String} Filename
 */
function generateFileName(mediaItem, pattern) {
  const { user, created, url } = mediaItem;
  const createdDate = created ? new Date(created) : new Date();
  
  // Default pattern: username-date-hash.ext
  if (!pattern) {
    const username = sanitizeString(user || 'unknown');
    const dateStr = format(createdDate, 'yyyyMMdd-HHmmss');
    const hash = getHashFromUrl(url);
    const ext = getExtensionFromUrl(url);
    
    return `${username}-${dateStr}-${hash}${ext}`;
  }
  
  // Advanced: Custom pattern support
  // Example: [user]-[date:yyyyMMdd]-[hash].[ext]
  // TODO: Implement custom pattern parsing
  return pattern;
}

/**
 * Extract a hash from GroupMe URL
 * 
 * @param {String} url GroupMe media URL
 * @returns {String} Hash portion of the URL
 */
function getHashFromUrl(url) {
  const imageHashMatch = /(.{32})\s*$/.exec(url);
  const videoHashMatch = /([^/]+$)/.exec(url);
  
  if (imageHashMatch) {
    return imageHashMatch[0];
  } else if (videoHashMatch) {
    return videoHashMatch[0].split('.')[0];
  }
  
  return 'unknown';
}

/**
 * Determine file extension from URL
 * 
 * @param {String} url GroupMe media URL
 * @returns {String} File extension with dot
 */
function getExtensionFromUrl(url) {
  const IMAGE_FILE_TYPES = /\.(png|jpeg|jpg|gif|bmp|webp)/;
  const VIDEO_FILE_TYPES = /\.(mp4|mov|wmv|mkv|webm)/;
  
  // Check if URL contains image hostname
  const isImage = url.includes('i.groupme.com');
  
  // Try to extract extension from URL
  const fileTypes = isImage ? IMAGE_FILE_TYPES : VIDEO_FILE_TYPES;
  const match = fileTypes.exec(url);
  
  if (match && match.length > 0) {
    return match[0];
  }
  
  // Default extensions based on URL type
  return isImage ? '.jpg' : '.mp4';
}

/**
 * Sanitize string for filesystem use
 * 
 * @param {String} string Input string
 * @returns {String} Sanitized string
 */
function sanitizeString(string) {
  if (!string) return 'unknown';
  
  return string
    .trim()
    .replace(/\s+/g, '-')
    .replace(/([<>:"\/\\|?*])/g, '_')
    .replace(/[^a-zA-Z0-9\-_]/g, '_');
}