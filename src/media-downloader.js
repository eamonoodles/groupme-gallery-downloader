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
 * An image URL could be any of the following:
 *   - https://i.groupme.com/06a398bdf6bd9db15f47a27f72fcecea
 *   - https://i.groupme.com/999x999.jpeg.06a398bdf6bd9db15f47a27f72fcecea
 *   - https://i.groupme.com/999x999.jpeg.06a398bdf6bd9db15f47a27f72fcecea.large
 *
 * Whomever architected this needs to be sat in a corner and made
 * to write "I will not break file naming conventions for dumb arbitrary reasons" a thousand times.
 *
 * @param  {String} URL to a GroupMe image or video
 * @return {String} '<hash>.<extension>'
 */
function renameFile(fileUrl, userName) {
  const URL = url.parse(fileUrl);
  const host = URL.hostname;

  // This is the only reliable way to determine if a download is an image
  // due to groupme sometimes not bothering giving a file an extension.
  // Someday I'll write something to crack open the file and get the headers
  // ¯\_(ツ)_/¯
  const isImage = host === 'i.groupme.com';

  // Grab the first 32 chars of each image name
  const imageHashMatch = /(.{32})\s*$/.exec(fileUrl);
  const imageHash = imageHashMatch ? imageHashMatch[0] : 'unknown';

  // Video URL's
  const videoHashMatch = /([^/]+$)/.exec(fileUrl);
  const videoHash = videoHashMatch ? videoHashMatch[0].split('.')[0] : 'unknown';

  // I think I accounted for all possible filetypes Groupme supports.
  // Knowing them, this will eventually error out somehow.
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
  // Which would be immensely fucking useful here.
  let fileType = '';
  if (hasFileType) {
    fileType = possibleFileType[0];
  } else {
    // Most common media formats on GroupMe. This could be wrong. Again, EXIF Data would be useful.
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
 * @param  {Object} User selected group
 * @param  {Object} socketIO (optional) - Socket.IO instance for real-time updates
 * @return {Promise} Resolves when all downloads are complete
 */
export function mediaDownloader({ media, id }, socketIO) {
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

      const downloader = (arr, curr = 1) => {
        if (arr.length) {
          let { url: URL, user: USER, created: CREATED_AT } = arr[0];

          // Ensure all URL's exist, and are pointing to GroupMe
          if (!URL || typeof URL !== 'string' || !URL.includes('groupme.com')) {
            logWithTime(chalk.yellow(`Skipping invalid URL for item ${curr}`));
            curr = curr + 1;
            db.removeMediaItem(id, { url: URL });
            return downloader(db.getMedia(id), curr);
          }

          logWithTime(chalk.cyan(`Starting download ${curr}/${TOTAL_PHOTOS}: ${URL}`));
          
          // Send socket update if available
          if (socketIO) {
            socketIO.emit('mediaDownloading', { 
              groupId: id,
              current: curr,
              total: TOTAL_PHOTOS,
              url: URL,
              user: USER
            });
          }
          
          const fileName = renameFile(URL, USER);
          const filePath = `${GROUP_MEDIA_DIR}/${fileName}`;
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
            db.removeMediaItem(id, { url: URL });
            curr = curr + 1;
            return downloader(db.getMedia(id), curr);
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
              db.removeMediaItem(id, { url: URL });
              curr = curr + 1;

              return downloader(db.getMedia(id), curr);
            }

            const total = Number(response.headers['content-length']);
            
            // If we don't have content-length, print more info
            if (!total) {
              logWithTime(chalk.yellow(`Warning: No content-length header for ${URL}`));
            }
            
            const bar = new ProgressBar(`${getTimestamp()} Downloading [:bar] [${curr} / ${TOTAL_PHOTOS}]`, {
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
                  logWithTime(chalk.cyan(`Still downloading #${curr}, received ${(receivedBytes/1024/1024).toFixed(2)}MB so far...`));
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
                  logWithTime(chalk.green(`Download #${curr} completed successfully in ${elapsed.toFixed(1)}s`));
                  
                  // Send socket update if available
                  if (socketIO) {
                    socketIO.emit('mediaDownloaded', {
                      groupId: id,
                      fileName,
                      filePath: `/media/${id}/${fileName}`,
                      current: curr,
                      total: TOTAL_PHOTOS
                    });
                  }
                } catch (err) {
                  logWithTime(chalk.yellow(`Couldn't set timestamp for ${fileName}: ${err.message}`));
                }
              });

              curr = curr + 1;
              db.removeMediaItem(id, { url: URL });

              // Small delay between downloads to avoid overwhelming connections
              setTimeout(() => {
                return downloader(db.getMedia(id), curr);
              }, 100);
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
            
            db.removeMediaItem(id, { url: URL });
            curr = curr + 1;
            return downloader(db.getMedia(id), curr);
          });

          file.on('error', (error) => {
            logWithTime(chalk.red(`File system error for ${URL}: ${error.message}`));
            clearTimeout(downloadTimeout);
            request.destroy();
            
            db.removeMediaItem(id, { url: URL });
            curr = curr + 1;
            return downloader(db.getMedia(id), curr);
          });

          request.end();
        } else {
          logWithTime(chalk.green('All downloads completed!'));
          resolve(); // Resolve the promise when all downloads are done
        }
      };

      if (!!media.length) {
        logWithTime(chalk.green(`Starting download of ${TOTAL_PHOTOS} media items`));
        downloader(media);
      } else {
        logWithTime(chalk.green('No media to download!'));
        resolve(); // Resolve immediately if no media to download
      }
    } catch (error) {
      logWithTime(chalk.red('Error in media downloader:'), error);
      reject(error); // Reject the promise if there's an error
    }
  });
}