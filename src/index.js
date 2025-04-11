import inquirer from 'inquirer';
import chalk from 'chalk';
import apiRequest from './request';
import { mediaListBuilder } from './media-list-builder';
import { mediaDownloader } from './media-downloader';
import db from './db';
import { startGUI } from './gui';

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
 * Prompt the user to select one or multiple groups.
 *
 * @param {Array} availableGroups Array of groups the user has access too, returned from the API
 */
function selectGroups(availableGroups) {
  const singleGroupQuestion = {
    type: 'confirm',
    name: 'multiSelect',
    message: 'Would you like to download media from multiple groups?',
    default: false
  };

  return inquirer.prompt(singleGroupQuestion).then(({ multiSelect }) => {
    if (multiSelect) {
      const multiGroupQuestion = {
        type: 'checkbox',
        name: 'groupIds',
        message: 'Select the groups you want to download (use space to select)',
        choices: availableGroups,
        validate: (answer) => {
          if (answer.length < 1) {
            return 'You must choose at least one group.';
          }
          return true;
        }
      };
      return inquirer.prompt(multiGroupQuestion).then(({ groupIds }) => groupIds);
    } else {
      const singleQuestion = {
        type: 'list',
        name: 'id',
        message: 'Select a group',
        choices: availableGroups,
      };
      return inquirer.prompt(singleQuestion).then(({ id }) => [id]);
    }
  });
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

  const groupIds = await selectGroups(availableGroups);
  
  db.setToken(authToken);
  
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
 */
async function processGroupMedia(authToken, groupId) {
  console.log(chalk.cyan(`\nProcessing group ID: ${chalk.green(groupId)}`));
  
  const localGroupData = db.getGroup(groupId);

  if (localGroupData && localGroupData.media && !!localGroupData.media.length) {
    console.log(
      `Restarting where you left off. ${chalk.green(localGroupData.media.length)} downloads to go!`
    );
    await mediaDownloader(localGroupData);
  } else {
    const mediaListFromRemote = await mediaListBuilder(authToken, groupId);
    await mediaDownloader(mediaListFromRemote);
  }
}

/**
 * Function called once we have a supplied developer access token from main()
 *
 * Process multiple groups sequentially
 * 
 * @param {string} token Supplied developer token
 * @returns void
 */
async function processGroupmeData(token) {
  try {
    const { authToken, groupIds } = await selectFromAvailableGroups(token);
    
    console.log(chalk.cyan(`Selected ${chalk.green(groupIds.length)} groups for downloading`));
    
    // Process each group sequentially
    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      console.log(chalk.cyan(`\nProcessing group ${i + 1} of ${groupIds.length}`));
      await processGroupMedia(authToken, groupId);
    }
    
    console.log(chalk.green('\nAll groups have been processed!'));
  } catch (error) {
    console.error(chalk.red('Error processing groups:'), error);
  }
}

/**
 * Choose between CLI or GUI mode
 */
function chooseInterface() {
  const question = [
    {
      type: 'list',
      name: 'selectedInterface', // Renamed from 'interface' to 'selectedInterface'
      message: 'How would you like to use GroupMe Gallery Downloader?',
      choices: [
        { name: 'Command Line Interface', value: 'cli' },
        { name: 'Graphical User Interface', value: 'gui' }
      ]
    }
  ];

  inquirer.prompt(question).then(({ selectedInterface }) => {
    if (selectedInterface === 'gui') {
      console.log(chalk.cyan('Starting GUI...'));
      startGUI();
    } else {
      startCLI();
    }
  });
}

/**
 * Start the traditional CLI version
 */
function startCLI() {
  const existingToken = db.getToken();
  const questionEnterApiToken = [
    {
      type: 'input',
      name: 'authToken',
      message: 'Enter your GroupMe API token:',
    },
  ];

  if (existingToken) {
    const tokenShortSha = chalk.yellow(existingToken.substr(0, 7));
    const questions = [
      {
        type: 'confirm',
        name: 'cachedToken',
        message: `Do you want to use your existing token: ${tokenShortSha}... ?`,
      },
    ];

    inquirer.prompt(questions).then(({ cachedToken }) => {
      if (cachedToken) {
        processGroupmeData(existingToken);
      } else {
        inquirer.prompt(questionEnterApiToken).then(({ authToken }) => {
          processGroupmeData(authToken);
        });
      }
    });
  } else {
    inquirer.prompt(questionEnterApiToken).then(({ authToken }) => {
      processGroupmeData(authToken);
    });
  }
}

/**
 * Inquirer and download instantiation
 */
async function main() {
  db.createDb();
  
  console.log(chalk.green('----------------------------------------'));
  console.log(chalk.green('| GroupMe Gallery Downloader v1.2.0    |'));
  console.log(chalk.green('----------------------------------------'));
  
  chooseInterface();
}

main();