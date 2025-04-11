// src/gui-start.js
import { startGUI } from './gui';
import db from './db';

// Initialize the database
db.createDb();

// Start the GUI server
console.log('Starting GroupMe Gallery Downloader GUI...');
startGUI();