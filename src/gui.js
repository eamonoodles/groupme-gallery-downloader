// src/gui.js
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import apiRequest from './request';
import { mediaListBuilder } from './media-list-builder';
import { mediaDownloader } from './media-downloader';
import db from './db';
import open from 'open';

const __filename = __filename || module.filename;
const __dirname = path.dirname(__filename);


const express = require('express');
const app = express();
const server = require('http').createServer(app);

// Setup express app
const PORT = 3456; // Default port

server.listen(PORT, () => {
  console.log(`GUI running on http://localhost:${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} in use, trying ${PORT + 1}...`);
    server.listen(PORT + 1, () => {
      console.log(`GUI running on http://localhost:${PORT + 1}`);
    });
  }
});

export function startGUI() {
  // Ensure the correct path
  const packageJsonPath = path.join(__dirname, '../package.json');
  const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (!packageData.dependencies.open) {
    packageData.dependencies.open = "^8.4.0";
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2));
    console.log('Added open dependency. Please run npm install.');
  }

  if (!packageData.dependencies.express) {
    packageData.dependencies.express = "^4.17.1";
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2));
    console.log('Added express dependency. Please run npm install.');
  }

  if (!packageData.dependencies['socket.io']) {
    packageData.dependencies['socket.io'] = "^4.4.1";
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2));
    console.log('Added socket.io dependency. Please run npm install.');
  }

  // Create public directory if it doesn't exist
  const publicDir = path.join(__dirname, '../public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
  }

  // Create HTML, CSS, and JS files
  createHTMLFile(publicDir);
  createCSSFile(publicDir);
  createClientJSFile(publicDir);

  // Setup express static files
  app.use(express.static(publicDir));
  app.use(express.json());
  
  // API routes
  app.get('/api/token', (req, res) => {
    const token = db.getToken();
    res.json({ token: token || '' });
  });

  app.post('/api/token', (req, res) => {
    const { token } = req.body;
    db.setToken(token);
    res.json({ success: true });
  });

  app.get('/api/preview/:groupId', async (req, res) => {
    const token = db.getToken();
    const { groupId } = req.params;
    
    if (!token) {
      return res.status(401).json({ error: 'No token available' });
    }

    try {
      const response = await apiRequest(token, `groups/${groupId}/messages?limit=20`);
      const messages = await response.json();
      
      // Filter messages with attachments that are images
      const imageUrls = messages.response.messages
        .filter(msg => msg.attachments && msg.attachments.some(att => att.type === 'image'))
        .map(msg => msg.attachments.find(att => att.type === 'image').url);

      res.json({ images: imageUrls });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch image previews' });
    }
  });

  app.get('/api/groups', async (req, res) => {
    const token = db.getToken();
    if (!token) {
      return res.status(401).json({ error: 'No token available' });
    }

    try {
      const groups = await fetchAvailableGroups(token);
      // Add preview flag to each group
      const groupsWithPreview = groups.map(group => ({
        ...group,
        hasPreview: true
      }));
      res.json({ groups: groupsWithPreview });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  });

  app.post('/api/download', async (req, res) => {
    const { groupIds } = req.body;
    const token = db.getToken();
    
    if (!token) {
      return res.status(401).json({ error: 'No token available' });
    }

    // Respond immediately to avoid timeout
    res.json({ success: true, message: 'Download started' });

    // Create database entries for each selected group
    groupIds.forEach(id => {
      db.createGroup(id);
    });

    // Start download process in background
    processGroups(token, groupIds);
  });

  app.get('/api/media/:groupId', (req, res) => {
    const { groupId } = req.params;
    const mediaDir = path.join(__dirname, '../media', groupId);
    
    if (!fs.existsSync(mediaDir)) {
      return res.json({ files: [] });
    }

    const files = fs.readdirSync(mediaDir)
      .filter(file => !file.startsWith('.'))
      .map(file => ({
        name: file,
        path: `/media/${groupId}/${file}`,
        date: fs.statSync(path.join(mediaDir, file)).mtime
      }))
      .sort((a, b) => b.date - a.date);

    res.json({ files });
  });

  // Serve media files
  app.use('/media', express.static(path.join(__dirname, '../media')));

  // Start the server
  server = http.createServer(app);
  
  // Setup Socket.io
  socketIO = require('socket.io')(server);
  
  socketIO.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });

  server.listen(PORT, () => {
    console.log(`GUI server running at http://localhost:${PORT}`);
    open(`http://localhost:${PORT}`);
  });

  return server;
}

// Override console.log to also emit socket events
const originalConsoleLog = console.log;
console.log = function() {
  originalConsoleLog.apply(console, arguments);
  if (socketIO) {
    const message = Array.from(arguments).join(' ');
    socketIO.emit('log', { message });
  }
};

/**
 * Fetch the groups a user has access to.
 */
async function fetchAvailableGroups(authToken) {
  let allGroups = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    console.log(`Fetching groups page ${page}...`);
    
    try {
      const response = await apiRequest(authToken, 'groups', {
        page: page,
        per_page: 100
      });
      
      if (response.status === 401) {
        throw new Error('Unauthorized, likely an invalid token');
      }
      
      const data = await response.json();
      const groups = data.response;
      
      if (groups && groups.length > 0) {
        allGroups = [...allGroups, ...groups.map(({ name, id }) => ({ name, id }))];
        page++;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      hasMore = false;
    }
  }
  
  return allGroups;
}

/**
 * Process multiple groups sequentially
 */
async function processGroups(authToken, groupIds) {
  console.log(`Selected ${groupIds.length} groups for downloading`);
  
  socketIO.emit('downloadStarted', { 
    totalGroups: groupIds.length
  });
  
  try {
    // Process each group sequentially
    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      console.log(`\nProcessing group ${i + 1} of ${groupIds.length}`);
      
      socketIO.emit('groupProcessing', { 
        groupId,
        current: i + 1,
        total: groupIds.length
      });
      
      await processGroupMedia(authToken, groupId);
    }
    
    console.log('\nAll groups have been processed!');
    socketIO.emit('downloadCompleted');
  } catch (error) {
    console.error('Error processing groups:', error);
    socketIO.emit('downloadError', { error: error.message });
  }
}

/**
 * Process a single group's media
 */
async function processGroupMedia(authToken, groupId) {
  console.log(`\nProcessing group ID: ${groupId}`);
  
  const localGroupData = db.getGroup(groupId);

  if (localGroupData && localGroupData.media && !!localGroupData.media.length) {
    console.log(
      `Restarting where you left off. ${localGroupData.media.length} downloads to go!`
    );
    socketIO.emit('mediaProcessing', {
      groupId,
      total: localGroupData.media.length,
      remaining: localGroupData.media.length
    });
    await mediaDownloader(localGroupData, socketIO);
  } else {
    const mediaListFromRemote = await mediaListBuilder(authToken, groupId);
    socketIO.emit('mediaProcessing', {
      groupId,
      total: mediaListFromRemote.media.length,
      remaining: mediaListFromRemote.media.length
    });
    await mediaDownloader(mediaListFromRemote, socketIO);
  }
}

// HTML file for the GUI
function createHTMLFile(publicDir) {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>GroupMe Gallery Downloader</title>
            <link rel="stylesheet" href="styles.css">
            <script src="/socket.io/socket.io.js"></script>
        </head>
        <body>
            <div class="container">
                <h1>GroupMe Gallery Downloader</h1>
                <div id="token-section" class="card">
                    <h2>API Token</h2>
                    <div class="input-group">
                        <input type="text" id="token-input" placeholder="Enter your GroupMe API token">
                        <button id="save-token-btn" class="primary-btn">Save Token</button>
                    </div>
                </div>
                <div id="groups-section" class="hidden">
                    <h2>Your Groups</h2>
                    <div class="button-container">
                        <button id="select-all-btn">Select All</button>
                        <button id="deselect-all-btn">Deselect All</button>
                        <button id="download-btn" class="primary-btn" disabled>Download Selected</button>
                    </div>
                    <div id="groups-loading" class="loading-spinner">Loading groups...</div>
                    <div id="groups-container"></div>
                </div>
                <div id="preview-section" class="hidden">
                    <h2>Image Previews</h2>
                    <div id="image-previews" class="preview-grid"></div>
                </div>
                <div id="progress-section" class="hidden">
                    <h2>Download Progress</h2>
                    <div class="progress-info">
                        <p>Group Progress: <span id="current-group">0</span>/<span id="total-groups">0</span></p>
                        <div class="progress-bar">
                            <div id="group-progress-fill" class="progress-fill"></div>
                        </div>
                        <p>Media Progress: <span id="completed-media">0</span>/<span id="total-media">0</span></p>
                        <div class="progress-bar">
                            <div id="media-progress-fill" class="progress-fill"></div>
                        </div>
                    </div>
                    <div id="log-container" class="log-container">
                        <div id="log-output"></div>
                    </div>
                </div>
            </div>
            <script src="app.js"></script>
        </body>
        </html>
    `;
    fs.writeFileSync(path.join(publicDir, 'index.html'), html);
}
// CSS file for the GUI
function createCSSFile(publicDir) {
    const cssContent = `
    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        line-height: 1.6;
        color: #333;
        background-color: #f5f5f5;
    }
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
    }
    header {
        text-align: center;
        margin-bottom: 30px;
    }
    h1 {
        color: #00aff0;
    }
    h2 {
        color: #333;
        margin-bottom: 15px;
    }
    .card {
        background-color: #fff;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        padding: 20px;
        margin-bottom: 20px;
    }
    .input-group {
        display: flex;
        margin-bottom: 10px;
    }
    input[type="text"],
    input[type="password"] {
        flex: 1;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        margin-right: 10px;
    }
    button {
        padding: 10px 15px;
        background-color: #f5f5f5;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.3s;
    }
    button:hover {
        background-color: #e9e9e9;
    }
    .primary-btn {
        background-color: #00aff0;
        color: white;
        border: none;
    }
    .primary-btn:hover {
        background-color: #0095cc;
    }
    .button-container {
        margin-top: 15px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }
    .hidden {
        display: none;
    }
    .groups-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 15px;
        margin-top: 15px;
    }
    .group-item {
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.3s;
    }
    .group-item:hover {
        background-color: #f9f9f9;
    }
    .group-item.selected {
        background-color: #e3f2fd;
        border-color: #00aff0;
    }
    .progress-bar {
        height: 20px;
        background-color: #f0f0f0;
        border-radius: 10px;
        margin: 10px 0 20px;
        overflow: hidden;
    }
    .progress-fill {
        height: 100%;
        background-color: #00aff0;
        width: 0%;
        transition: width 0.3s ease;
    }
    .log-container {
        margin-top: 20px;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 10px;
        max-height: 300px;
        overflow-y: auto;
    }
    #log-output {
        font-family: monospace;
        font-size: 12px;
        white-space: pre-wrap;
    }
    .log-entry {
        margin-bottom: 5px;
        border-bottom: 1px solid #eee;
        padding-bottom: 5px;
    }
    #media-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 15px;
        margin-top: 15px;
    }
    .media-item {
        border: 1px solid #ddd;
        border-radius: 4px;
        overflow: hidden;
    }
    .media-item img {
        width: 100%;
        height: 200px;
        object-fit: cover;
    }
    .media-info {
        padding: 10px;
        font-size: 12px;
    }
    select {
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        width: 100%;
        margin-bottom: 15px;
    }
    .loading-spinner {
        text-align: center;
        padding: 20px;
        color: #666;
    }
    footer {
        text-align: center;
        color: #666;
        margin-top: 30px;
    }
    footer a {
        color: #00aff0;
        text-decoration: none;
    }
    .preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
    }
    .preview-image {
        width: 100%;
        height: 200px;
        object-fit: cover;
        border-radius: 8px;
        cursor: pointer;
        transition: transform 0.2s;
    }
    .preview-image:hover {
        transform: scale(1.05);
    }
    `;
    fs.writeFileSync(path.join(publicDir, 'styles.css'), cssContent);
}
// Client-side JavaScript for the GUI
function createClientJSFile(publicDir) {
    const js = `
    document.addEventListener('DOMContentLoaded', function() {
        // ... rest of the code ...

        function renderGroups(groups) {
            const html = groups.map(group => \\\`
                <div class="group-item" data-id="\\\${group.id}">
                    <div class="group-info">
                        <h3>\\\${group.name}</h3>
                    </div>
                    <div class="group-actions">
                        <button onclick="showPreviews('\\\${group.id}')" class="preview-btn">
                            Show Previews
                        </button>
                        <button onclick="downloadGroup('\\\${group.id}')" class="download-btn primary-btn">
                            Download
                        </button>
                    </div>
                </div>
            \\\`).join('');
            groupsContainer.innerHTML = html;
        }

        // ... rest of the code ...
    });

    // Wrap client-side definitions to prevent errors in Node
    if (typeof window !== "undefined") {
        window.showPreviews = async function(groupId) {
            try {
                const response = await fetch(\`/api/preview/\${groupId}\`); // updated: escaped inner backticks
                const data = await response.json();
                
                previewGrid.innerHTML = data.images
                    .map(url => \`
                        <img 
                            src="\${url}" 
                            class="preview-image" 
                            alt="Group Image Preview"
                            onclick="window.open('\${url}', '_blank')"
                        >
                    \`)
                    .join('');
                            
                previewSection.style.display = 'block';
            } catch (error) {
                console.error('Failed to load previews:', error);
            }
        };
    }
    `;
    fs.writeFileSync(path.join(publicDir, 'app.js'), js);
}
