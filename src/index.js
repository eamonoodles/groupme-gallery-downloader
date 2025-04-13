import inquirer from 'inquirer';
import chalk from 'chalk';
import apiRequest from './request';
import { startGUI } from './gui';
import { mediaListBuilder } from './media-list-builder';
import { mediaDownloader } from './media-downloader';
import db from './db';
const portfinder = require('portfinder');

async function processGroupmeData(token) {
  try {
    // Fetch groups with pagination
    let allGroups = [];
    let page = 1;
    const PER_PAGE = 10;
    
    while (true) {
      console.log(`Fetching groups page ${page}...`);
      
      const response = await apiRequest(token, 'groups', {
        page: page,
        per_page: PER_PAGE
      });
      
      if (response.status === 401) {
        throw new Error('Invalid or expired token');
      }
      
      const data = await response.json();
      const groups = data.response;
      
      if (!groups || groups.length === 0) {
        break;
      }

      allGroups = [...allGroups, ...groups];
      
      // If we got fewer items than requested, we've hit the last page
      if (groups.length < PER_PAGE) {
        break;
      }
      
      page++;
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (allGroups.length === 0) {
      throw new Error('No groups found');
    }

    // Ask if user wants to select multiple groups
    const { multiSelect } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'multiSelect',
        message: 'Would you like to download from multiple groups?',
        default: false
      }
    ]);

    let selectedGroupIds;
    if (multiSelect) {
      const { groupIds } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'groupIds',
          message: 'Select groups to download (use space to select, enter to confirm):',
          choices: allGroups.map(g => ({ name: g.name, value: g.id })),
          validate: (answer) => {
            if (answer.length < 1) {
              return 'You must choose at least one group.';
            }
            return true;
          }
        }
      ]);
      selectedGroupIds = groupIds;
    } else {
      const { groupId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'groupId',
          message: 'Select a group to download:',
          choices: allGroups.map(g => ({ name: g.name, value: g.id }))
        }
      ]);
      selectedGroupIds = [groupId];
    }

    // Process each selected group
    for (let i = 0; i < selectedGroupIds.length; i++) {
      const groupId = selectedGroupIds[i];
      const group = allGroups.find(g => g.id === groupId);
      console.log(chalk.blue(`\nStarting download for ${group.name} (${i + 1}/${selectedGroupIds.length})...`));
      const mediaList = await mediaListBuilder(token, groupId);
      await mediaDownloader(mediaList);
    }
    
  } catch (error) {
    console.error(chalk.red('Error:', error.message));
    process.exit(1);
  }
}

async function main() {
  db.createDb();

  console.log(chalk.green('----------------------------------------'));
  console.log(chalk.green('| GroupMe Gallery Downloader v1.2.0    |'));
  console.log(chalk.green('----------------------------------------'));

  const { mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'How would you like to use GroupMe Gallery Downloader?',
      choices: ['Command Line Interface', 'Graphical User Interface']
    }
  ]);

  if (mode === 'Graphical User Interface') {
    startGUIWithPortHandling();
  } else {
    await startCLI();
  }
}

function startGUIWithPortHandling() {
  portfinder.getPort({ port: 3456 }, (err, port) => {
    if (err) {
      console.error(chalk.red('Error finding an available port:'), err);
      return;
    }
    console.log(`Starting GUI on port ${port}...`);
    startGUI(port);
  });
}

async function startCLI() {
  const existingToken = db.getToken();

  if (existingToken) {
    const { useExisting } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useExisting',
        message: `Do you want to use your existing token: ${existingToken.slice(0, 8)}... ?`
      }
    ]);

    if (useExisting) {
      await processGroupmeData(existingToken);
      return;
    }
  }

  const { token } = await inquirer.prompt([
    {
      type: 'input',
      name: 'token',
      message: 'Please enter your GroupMe API token:'
    }
  ]);

  db.setToken(token);
  await processGroupmeData(token);
}

// Call the main function
main();