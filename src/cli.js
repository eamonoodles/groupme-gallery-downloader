// src/cli.js
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import db from './db';

/**
 * Parse command line arguments for non-interactive mode
 * @returns {Object} Parsed arguments
 */
export function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  const options = {
    token: null,
    groupId: null,
    multiGroups: null,
    parallel: 3,
    output: null,
    interactive: true,
  };

  // Simple argument parser
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--token' || arg === '-t') {
      options.token = args[++i];
    } else if (arg === '--group' || arg === '-g') {
      options.groupId = args[++i];
    } else if (arg === '--multi-groups' || arg === '-m') {
      options.multiGroups = args[++i];
    } else if (arg === '--parallel' || arg === '-p') {
      const value = parseInt(args[++i], 10);
      options.parallel = !isNaN(value) && value > 0 ? value : 3;
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--non-interactive') {
      options.interactive = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print usage information
 */
function printHelp() {
  console.log(`
${chalk.bold('GroupMe Gallery Downloader')} - Download photos from your GroupMe conversations

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

/**
 * Handle token input or retrieval
 * @returns {Promise<string>} Token
 */
export async function getAuthToken() {
  const options = parseCommandLineArgs();
  const existingToken = db.getToken();
  
  // If token is provided via command line, use it
  if (options.token) {
    db.setToken(options.token);
    return options.token;
  }
  
  // If we're in non-interactive mode but have an existing token, use it
  if (!options.interactive && existingToken) {
    return existingToken;
  }
  
  // If we're in non-interactive mode but don't have a token, throw error
  if (!options.interactive && !existingToken) {
    console.error(chalk.red('Error: API token is required in non-interactive mode.'));
    console.error(chalk.yellow('Provide token with --token option or run in interactive mode.'));
    process.exit(1);
  }

  // Interactive mode token handling
  if (existingToken) {
    const tokenShortSha = chalk.yellow(existingToken.substr(0, 7));
    const { cachedToken } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'cachedToken',
        message: `Do you want to use your existing token: ${tokenShortSha}... ?`,
      },
    ]);

    if (cachedToken) {
      return existingToken;
    }
  }

  // Need to get a new token
  const { authToken } = await inquirer.prompt([
    {
      type: 'input',
      name: 'authToken',
      message: 'Enter your GroupMe API token:',
      validate: input => input.trim().length > 0 ? true : 'Token is required',
    },
  ]);

  db.setToken(authToken);
  return authToken;
}

/**
 * Process command line arguments for group selection
 * @param {Array} availableGroups - List of groups from the API
 * @returns {Promise<Array>} - Selected group IDs
 */
export async function processGroupSelection(availableGroups) {
  const options = parseCommandLineArgs();
  
  // Check for group ID from command line
  if (options.groupId) {
    return [options.groupId];
  }
  
  // Check for multi-group IDs from command line
  if (options.multiGroups) {
    return options.multiGroups.split(',').map(id => id.trim());
  }
  
  // If in non-interactive mode but no groups specified, error
  if (!options.interactive) {
    console.error(chalk.red('Error: Group ID is required in non-interactive mode.'));
    console.error(chalk.yellow('Provide group ID with --group or --multi-groups option.'));
    process.exit(1);
  }
  
  // Interactive selection
  const { multiSelect } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'multiSelect',
      message: 'Would you like to download media from multiple groups?',
      default: false
    }
  ]);
  
  if (multiSelect) {
    const { groupIds } = await inquirer.prompt([
      {
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
      }
    ]);
    return groupIds;
  } else {
    const { id } = await inquirer.prompt([
      {
        type: 'list',
        name: 'id',
        message: 'Select a group',
        choices: availableGroups,
      }
    ]);
    return [id];
  }
}

/**
 * Get the parallel download count from args or prompt user
 * @returns {Promise<number>} Number of parallel downloads
 */
export async function getParallelCount() {
  const options = parseCommandLineArgs();
  
  // If specified in command line
  if (options.parallel) {
    return options.parallel;
  }
  
  // Default for non-interactive mode
  if (!options.interactive) {
    return 3;
  }
  
  // Ask in interactive mode
  const { parallelCount } = await inquirer.prompt([
    {
      type: 'number',
      name: 'parallelCount',
      message: 'How many parallel downloads? (1-10)',
      default: 3,
      validate: (input) => {
        const num = parseInt(input, 10);
        if (isNaN(num) || num < 1 || num > 10) {
          return 'Please enter a number between 1 and 10';
        }
        return true;
      }
    }
  ]);
  
  return parallelCount;
}

/**
 * Get output directory from args or prompt user
 * @returns {Promise<string|null>} Custom output directory or null for default
 */
export async function getOutputDirectory() {
  const options = parseCommandLineArgs();
  
  // If specified in command line
  if (options.output) {
    // Create directory if it doesn't exist
    if (!fs.existsSync(options.output)) {
      fs.mkdirSync(options.output, { recursive: true });
    }
    return options.output;
  }
  
  // Default directory for non-interactive mode
  if (!options.interactive) {
    return null;
  }
  
  // Ask in interactive mode
  const { useCustomDir } = await inquirer.prompt([
    {
      type: 'confirm', 
      name: 'useCustomDir',
      message: 'Would you like to use a custom output directory?',
      default: false
    }
  ]);
  
  if (!useCustomDir) {
    return null;
  }
  
  const { customDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'customDir',
      message: 'Enter the directory path for downloads:',
      default: path.join(process.cwd(), 'media'),
      validate: (input) => {
        if (!input.trim()) {
          return 'Directory path cannot be empty';
        }
        return true;
      }
    }
  ]);
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(customDir)) {
    fs.mkdirSync(customDir, { recursive: true });
  }
  
  return customDir;
}