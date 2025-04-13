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
    // Fetch available groups first
    const response = await apiRequest(token, 'groups');
    if (response.status === 401) {
      throw new Error('Invalid or expired token');
    }
    
    const data = await response.json();
    const groups = data.response;
    
    if (!groups || groups.length === 0) {
      throw new Error('No groups found');
    }

    // Let user select a group
    const { groupId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'groupId',
        message: 'Select a group to download:',
        choices: groups.map(g => ({ name: g.name, value: g.id }))
      }
    ]);

    console.log(chalk.blue(`Starting download for selected group...`));
    const mediaList = await mediaListBuilder(token, groupId);
    await mediaDownloader(mediaList);
    
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