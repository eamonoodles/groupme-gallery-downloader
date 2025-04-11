// src/media-downloader.js
import ProgressBar from 'progress';
import https from 'https';
import url from 'url';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import db from './db';

const MEDIA_DIR = path.resolve(__dirname, '../', 'media');
const IMAGE_FILE_TYPES = /\.(png|jpeg|jpg|gif|bmp|webp)/;
const VIDEO_FILE_TYPES = /\.(mp4|mov|wmv|mkv|webm)/;
const DOWNLOAD_TIMEOUT = 30000; // 30 seconds timeout

/**
 * Returns current timestamp in [HH:MM:SS] format
 */
function getTimestamp() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `[${hours}:${minutes}:${seconds}]`;
}

/**
 * Log with timestamp
 */
function logWithTime(message, ...args) {
  console.log(`${chalk.gray(getTimestamp())} ${message}`, ...args);
}

/**
 * All GroupMe photos either are, or end with, a 32 digit hash.
 * Groupme file names aren't consistent, so we need to do a bunch
 * of checking and guarding against these inconsistencies
 *
 * @param  {String} URL to a GroupMe image or video
 * @return {String} '<hash>.<extension>'
 */
function renameFile(fileUrl, userName) {
  const URL = url.parse(fileUrl);
  const host = URL.hostname;

  // This is the only reliable way to determine if a download is an image
  // due to groupme sometimes not bothering giving a file an extension.
  const isImage = host === 'i.groupme.com';

  // Grab the first 32 chars of each image name
  const imageHashMatch = /(.{32})\s*$/.exec(fileUrl);
  const imageHash = imageHashMatch ? imageHashMatch[0] : 'unknown';

  // Video URL's
  const videoHashMatch = /([^/]+$)/.exec(fileUrl);
  const videoHash = videoHashMatch ? videoHashMatch[0].split('.')[0] : 'unknown';

  // I think I accounted for all possible filetypes Groupme supports.
  const fileTypes = isImage ? IMAGE_FILE_TYPES : VIDEO_FILE_TYPES;

  // Maybe it's a file? Probably worth checking later...
  const possibleFileType = fileTypes.exec(fileUrl);

  // Super naive filetype check
  const hasFileType = possibleFileType && possibleFileType.length > 0;

  // Which hash to use
  const hash = isImage ? imageHash : videoHash;

  // Filesystem safe string for usernames
  const user = userName.split(' ').join('_');

  // To the best of my knowledge, GroupMe strips EXIF data.
  let fileType = '';
  if (hasFileType) {
    fileType = possibleFileType[0];
  } else {
    // Most common media formats on GroupMe. This could be wrong.
    if (isImage) {
      fileType = '.jpg';
    } else {
      fileType = '.mp4';
    }
  }

  // Final filename
  return `${user}-${hash}${fileType}`;
}

function requestMediaItem(mediaUrl) {
  return https.request({
    host: url.parse(mediaUrl).host,
    path: url.parse(mediaUrl).pathname,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36',
      Referer: 'https://app.groupme.com/chats',
    },
    timeout: DOWNLOAD_TIMEOUT,
  });
}

/**
 * Downloads a single media item
 * 
 * @param {Object} item Media item to download
 * @param {String} outputPath Path to save the file
 * @param {Number} currentIndex Current download index
 * @param {Number} totalCount Total number of downloads
 * @param {String} groupId Group ID for database updates
 * @returns {Promise<boolean>} Promise resolving to true for success, false for failure
 */
async function downloadSingleItem(item, outputPath, currentIndex, totalCount, groupId) {
  return new Promise((resolve) => {
    const { url: URL, user: USER, created: CREATED_AT } = item;

    // Ensure all URL's exist, and are pointing to GroupMe
    if (!URL || typeof URL !== 'string' || !URL.includes('groupme.com')) {
      logWithTime(chalk.yellow(`Skipping invalid URL for item ${currentIndex}/${totalCount}`));
      db.removeMediaItem(groupId, { url: URL });
      return resolve(false);
    }

    logWithTime(chalk.cyan(`Starting download ${currentIndex}/${totalCount}: ${URL}`));
    
    const fileName = renameFile(URL, USER);
    const filePath = path.join(outputPath, fileName);
    const file = fs.createWriteStream(filePath);
    const request = requestMediaItem(URL);
    let downloadStartTime = Date.now();

    // Set a timeout for the entire download operation
    const downloadTimeout = setTimeout(() => {
      const elapsed = (Date.now() - downloadStartTime) / 1000;
      logWithTime(chalk.red(`Download timed out after ${elapsed.toFixed(1)} seconds: ${URL}`));
      request.destroy();
      file.end();
      
      // Clean up partial file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      // Move on to the next item
      db.removeMediaItem(groupId, { url: URL });
      resolve(false);
    }, DOWNLOAD_TIMEOUT);

    request.on('response', (response) => {
      /**
       * So apparently GroupMe passes through URL's to certain meme maker sites
       * and sometimes those sites 301 or throw other shitty errors.
       */
      if (response.statusCode !== 200) {
        logWithTime(
          chalk.yellow('Skipping, could not fetch:'),
          URL,
          'Due to:',
          response.statusCode,
          response.statusMessage
        );

        clearTimeout(downloadTimeout);
        file.end();
        db.removeMediaItem(groupId, { url: URL });
        return resolve(false);
      }

      const total = Number(response.headers['content-length']);
      
      // If we don't have content-length, print more info
      if (!total) {
        logWithTime(chalk.yellow(`Warning: No content-length header for ${URL}`));
      }
      
      const bar = new ProgressBar(`${getTimestamp()} Downloading [:bar] [${currentIndex} / ${totalCount}]`, {
        complete: '=',
        incomplete: '-',
        width: 20,
        total: total || 1000000, // Default value if content-length is missing
      });

      let receivedBytes = 0;
      let lastProgressTime = Date.now();

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        file.write(chunk);
        
        if (total) {
          bar.tick(chunk.length);
        } else {
          // If no content-length, provide more detailed progress
          const now = Date.now();
          if (now - lastProgressTime > 5000) { // Every 5 seconds
            lastProgressTime = now;
            logWithTime(chalk.cyan(`Still downloading #${currentIndex}, received ${(receivedBytes/1024/1024).toFixed(2)}MB so far...`));
          }
        }
      });

      response.on('end', () => {
        const elapsed = (Date.now() - downloadStartTime) / 1000;
        clearTimeout(downloadTimeout);
        
        file.end(() => {
          try {
            // Change the local file system's timestamp to the original upload date of the file
            if (CREATED_AT) {
              const timestamp = new Date(CREATED_AT);
              fs.utimesSync(filePath, timestamp, timestamp);
            }
            logWithTime(chalk.green(`Download #${currentIndex} completed successfully in ${elapsed.toFixed(1)}s`));
            db.removeMediaItem(groupId, { url: URL });
            resolve(true);
          } catch (err) {
            logWithTime(chalk.yellow(`Couldn't set timestamp for ${fileName}: ${err.message}`));
            db.removeMediaItem(groupId, { url: URL });
            resolve(true);
          }
        });
      });
    });

    // Handle request errors
    request.on('error', (error) => {
      const elapsed = (Date.now() - downloadStartTime) / 1000;
      clearTimeout(downloadTimeout);
      logWithTime(chalk.red(`Error downloading ${URL} after ${elapsed.toFixed(1)}s: ${error.message}`));
      file.end();
      
      // Clean up partial file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      db.removeMediaItem(groupId, { url: URL });
      resolve(false);
    });

    file.on('error', (error) => {
      logWithTime(chalk.red(`File system error for ${URL}: ${error.message}`));
      clearTimeout(downloadTimeout);
      request.destroy();
      
      db.removeMediaItem(groupId, { url: URL });
      resolve(false);
    });

    request.end();
  });
}

/**
 * Process media items in batches with a given concurrency
 * 
 * @param {Array} mediaItems Array of media items to download
 * @param {String} outputDir Directory to save files to
 * @param {String} groupId Group ID for database updates
 * @param {Number} concurrency Number of parallel downloads
 * @returns {Promise<Object>} Results with success and failure counts
 */
async function processMediaBatch(mediaItems, outputDir, groupId, concurrency = 3) {
  let activeDownloads = 0;
  let itemIndex = 0;
  let completed = 0;
  let successful = 0;
  let failed = 0;
  const totalItems = mediaItems.length;
  
  // Create overall progress bar
  const overallBar = new ProgressBar(`${getTimestamp()} Overall Progress [:bar] [:current/:total] :percent :etas remaining`, {
    complete: '=',
    incomplete: ' ',
    width: 30,
    total: totalItems
  });
  
  return new Promise((resolve) => {
    const startNextDownload = () => {
      if (itemIndex >= totalItems) {
        if (activeDownloads === 0) {
          // All downloads complete
          logWithTime(chalk.green(`\nDownload complete! ${successful} successful, ${failed} failed`));
          resolve({ successful, failed });
        }
        return;
      }
      
      const item = mediaItems[itemIndex];
      const currentIndex = itemIndex + 1;
      itemIndex++;
      activeDownloads++;
      
      downloadSingleItem(item, outputDir, currentIndex, totalItems, groupId)
        .then(success => {
          activeDownloads--;
          completed++;
          overallBar.tick();
          
          if (success) {
            successful++;
          } else {
            failed++;
          }
          
          // Start next download
          startNextDownload();
        })
        .catch(() => {
          // Handle unexpected errors
          activeDownloads--;
          completed++;
          failed++;
          overallBar.tick();
          
          // Start next download
          startNextDownload();
        });
    };
    
    // Start initial batch of downloads
    for (let i = 0; i < Math.min(concurrency, totalItems); i++) {
      startNextDownload();
    }
  });
}

/**
 * @param  {Object} User selected group
 * @param  {Number} concurrency Number of parallel downloads (default: 3)
 * @return {Promise} Resolves when all downloads are complete
 */
export function mediaDownloader({ media, id }, concurrency = 3) {
  return new Promise((resolve, reject) => {
    try {
      const TOTAL_PHOTOS = media.length;

      if (!fs.existsSync(MEDIA_DIR)) {
        fs.mkdirSync(MEDIA_DIR);
      }

      let GROUP_MEDIA_DIR;

      if (!fs.existsSync(`${MEDIA_DIR}/${id}`)) {
        fs.mkdirSync(`${MEDIA_DIR}/${id}`, { recursive: true });
      }

      GROUP_MEDIA_DIR = path.resolve(MEDIA_DIR, id);

      if (!!media.length) {
        logWithTime(chalk.green(`Starting download of ${TOTAL_PHOTOS} media items using ${concurrency} parallel downloads`));
        
        // Use the new parallel download approach
        processMediaBatch(media, GROUP_MEDIA_DIR, id, concurrency)
          .then(() => {
            resolve();
          })
          .catch(error => {
            logWithTime(chalk.red('Error in batch processing:'), error);
            reject(error);
          });
      } else {
        logWithTime(chalk.green('No media to download!'));
        resolve();
      }
    } catch (error) {
      logWithTime(chalk.red('Error in media downloader:'), error);
      reject(error);
    }
  });
}