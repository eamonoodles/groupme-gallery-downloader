// src/index.js
import chalk from 'chalk';
import apiRequest from './request';
import { mediaListBuilder } from './media-list-builder';
import { mediaDownloader } from './media-downloader';
import db from './db';
import { 
  getAuthToken, 
  processGroupSelection, 
  getParallelCount,
  getOutputDirectory,
  parseCommandLineArgs
} from './cli';

/**
 * Fetch the groups a user has access to.
 *
 * @param  {String} authToken
 * @return {Promise}
 */
async function fetchAvailableGroups(authToken) {
  let allGroups = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    console.log(chalk.cyan(`Fetching groups page ${chalk.green(page)}...`));
    
    try {
      const response = await apiRequest(authToken, 'groups', {
        page: page,
        per_page: 100  // Request maximum number of groups per page
      });
      
      if (response.status === 401) {
        throw new Error(chalk.red('Unauthorized, likely an invalid token'));
      }
      
      const data = await response.json();
      const groups = data.response;
      
      if (groups && groups.length > 0) {
        allGroups = [...allGroups, ...groups.map(({ name, id }) => ({ name, value: id }))];
        page++;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(chalk.red('Error fetching groups:'), error);
      hasMore = false;
    }
  }
  
  return allGroups;
}

/**
 * Hit the groups API and offer up a list of available groups to the user
 *
 * @param  {String} User supplied auth token
 * @return {Promise} Pass back the selected group IDs
 */
async function selectFromAvailableGroups(authToken) {
  const availableGroups = await fetchAvailableGroups(authToken);

  if (availableGroups.length === 0) {
    throw new Error(chalk.red('Sorry, no groups were found.'));
  }

  const groupIds = await processGroupSelection(availableGroups);
  
  // Create database entries for each selected group
  groupIds.forEach(id => {
    db.createGroup(id);
  });

  return { authToken, groupIds };
}

/**
 * Process a single group's media
 * 
 * @param {String} authToken 
 * @param {String} groupId 
 * @param {Number} parallelCount
 * @param {String} outputDir
 */
async function processGroupMedia(authToken, groupId, parallelCount, outputDir) {
  console.log(chalk.cyan(`\nProcessing group ID: ${chalk.green(groupId)}`));
  
  const localGroupData = db.getGroup(groupId);

  if (localGroupData && localGroupData.media && !!localGroupData.media.length) {
    console.log(
      `Restarting where you left off. ${chalk.green(localGroupData.media.length)} downloads to go!`
    );
    await mediaDownloader(localGroupData, parallelCount);
  } else {
    const mediaListFromRemote = await mediaListBuilder(authToken, groupId);
    await mediaDownloader(mediaListFromRemote, parallelCount);
  }
}

/**
 * Function called once we have a supplied developer access token
 *
 * Process multiple groups with selected options
 * 
 * @returns void
 */
async function processGroupmeData() {
  try {
    // Get authentication token
    const authToken = await getAuthToken();
    
    // Get groups to process
    const { groupIds } = await selectFromAvailableGroups(authToken);
    
    // Get parallel download count
    const parallelCount = await getParallelCount();
    
    // Get custom output directory if specified
    const outputDir = await getOutputDirectory();
    
    console.log(chalk.cyan(`Selected ${chalk.green(groupIds.length)} groups for downloading with ${chalk.green(parallelCount)} parallel downloads`));
    
    // Process each group sequentially
    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      console.log(chalk.cyan(`\nProcessing group ${i + 1} of ${groupIds.length}`));
      await processGroupMedia(authToken, groupId, parallelCount, outputDir);
    }
    
    console.log(chalk.green('\nAll groups have been processed!'));
  } catch (error) {
    console.error(chalk.red('Error processing groups:'), error);
  }
}

/**
 * Main function
 */
async function main() {
  // First check if help was requested
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  
  // Initialize database
  db.createDb();
  
  // Start processing
  await processGroupmeData();
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
${chalk.bold('GroupMe Gallery Downloader')} - Download media from your GroupMe conversations

${chalk.yellow('Usage:')} npm start [options]

${chalk.yellow('Options:')}
  -t, --token <token>         Your GroupMe API token
  -g, --group <id>            Download from a specific group ID
  -m, --multi-groups <ids>    Download from multiple group IDs (comma-separated)
  -p, --parallel <number>     Number of parallel downloads (default: 3)
  -o, --output <directory>    Custom output directory
  --non-interactive           Run in non-interactive mode
  -h, --help                  Show this help

${chalk.yellow('Examples:')}
  npm start                                  # Run in interactive mode
  npm start -t YOUR_TOKEN                    # Use specific token
  npm start -g 12345678                      # Download from specific group
  npm start -m 12345678,87654321 -p 5        # Download from multiple groups with 5 parallel downloads
  `);
}

// Start the application
main();