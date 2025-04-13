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

const app = express();
const server = http.createServer(app);

let socketIO; // Declare at module scope

// Setup express app
const PORT = 3456; // Default port

export function startGUI() {
  // Initialize socket.io
  socketIO = require('socket.io')(server);

  // Override console.log for socket.io logging
  const originalConsoleLog = console.log;
  console.log = function() {
    originalConsoleLog.apply(console, arguments);
    if (socketIO) {
      const message = Array.from(arguments).join(' ');
      socketIO.emit('log', { message });
    }
  };

  // Socket.io connection handling
  socketIO.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });

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
      let allImages = [];
      let beforeId = null;
      let count = 0;
      const limit = 100;

      // Fetch messages until we have no more or hit reasonable limit
      while (count < 1000) {
        const endpoint = beforeId 
          ? `groups/${groupId}/messages?limit=${limit}&before_id=${beforeId}`
          : `groups/${groupId}/messages?limit=${limit}`;

        const response = await apiRequest(token, endpoint);
        const data = await response.json();
        const messages = data.response.messages;

        if (!messages || messages.length === 0) break;

        // Extract image URLs from this batch
        const imageUrls = messages
          .filter(msg => msg.attachments && msg.attachments.some(att => att.type === 'image'))
          .map(msg => msg.attachments.find(att => att.type === 'image').url);

        allImages = [...allImages, ...imageUrls];
        beforeId = messages[messages.length - 1].id;
        count += messages.length;

        if (messages.length < limit) break;
      }

      res.json({ images: allImages });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch images' });
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

  server.listen(PORT, () => {
    console.log(`GUI server running at http://localhost:${PORT}`);
    open(`http://localhost:${PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} in use, trying ${PORT + 1}...`);
      server.listen(PORT + 1, () => {
        console.log(`GUI server running at http://localhost:${PORT + 1}`);
        open(`http://localhost:${PORT + 1}`);
      });
    }
  });

  return server;
}

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
  
  if (socketIO) {
    socketIO.emit('downloadStarted', { 
      totalGroups: groupIds.length
    });
  }
  
  try {
    // Process each group sequentially
    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      console.log(`\nProcessing group ${i + 1} of ${groupIds.length}`);
      
      if (socketIO) {
        socketIO.emit('groupProcessing', { 
          groupId,
          current: i + 1,
          total: groupIds.length
        });
      }
      
      await processGroupMedia(authToken, groupId);
    }
    
    console.log('\nAll groups have been processed!');
    if (socketIO) {
      socketIO.emit('downloadCompleted');
    }
  } catch (error) {
    console.error('Error processing groups:', error);
    if (socketIO) {
      socketIO.emit('downloadError', { error: error.message });
    }
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
    if (socketIO) {
      socketIO.emit('mediaProcessing', {
        groupId,
        total: localGroupData.media.length,
        remaining: localGroupData.media.length
      });
    }
    await mediaDownloader(localGroupData, socketIO);
  } else {
    const mediaListFromRemote = await mediaListBuilder(authToken, groupId);
    if (socketIO) {
      socketIO.emit('mediaProcessing', {
        groupId,
        total: mediaListFromRemote.media.length,
        remaining: mediaListFromRemote.media.length
      });
    }
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
                    <div id="groups-container" class="groups-grid"></div>
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
        padding: 15px;
        margin-bottom: 10px;
        border: 1px solid #ddd;
        border-radius: 8px;
        position: relative;
    }
    .download-status {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: #ddd;
    }
    .download-status.downloaded {
        background-color: #4CAF50;
    }
    .download-status.downloading {
        background-color: #FFC107;
        animation: pulse 1s infinite;
    }
    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
    }
    .group-preview {
        display: none;
        margin-top: 15px;
        border-top: 1px solid #eee;
        padding-top: 15px;
    }
    .group-preview.active {
        display: block;
    }
    .preview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
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
        const socket = io();
        const tokenInput = document.getElementById('token-input');
        const saveTokenBtn = document.getElementById('save-token-btn');
        const groupsSection = document.getElementById('groups-section');
        const groupsContainer = document.getElementById('groups-container');
        const selectAllBtn = document.getElementById('select-all-btn');
        const deselectAllBtn = document.getElementById('deselect-all-btn');
        const downloadBtn = document.getElementById('download-btn');
        const progressSection = document.getElementById('progress-section');
        const currentGroup = document.getElementById('current-group');
        const totalGroups = document.getElementById('total-groups');
        const completedMedia = document.getElementById('completed-media');
        const totalMedia = document.getElementById('total-media');
        const groupProgressFill = document.getElementById('group-progress-fill');
        const mediaProgressFill = document.getElementById('media-progress-fill');
        const logOutput = document.getElementById('log-output');
        
        // Check for existing token
        fetch('/api/token')
            .then(response => response.json())
            .then(data => {
                if (data.token) {
                    tokenInput.value = data.token;
                    loadGroups();
                }
            });

        // Save token
        saveTokenBtn.addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (!token) return;

            fetch('/api/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            })
            .then(() => loadGroups());
        });

        // Load groups
        function loadGroups() {
            groupsSection.classList.remove('hidden');
            groupsContainer.innerHTML = '<div class="loading-spinner">Loading groups...</div>';

            fetch('/api/groups')
                .then(response => response.json())
                .then(data => {
                    if (data.groups) {
                        renderGroups(data.groups);
                    }
                })
                .catch(error => {
                    groupsContainer.innerHTML = '<div class="error">Failed to load groups</div>';
                    console.error('Error:', error);
                });
        }

        function renderGroups(groups) {
            const html = groups.map(group => \`
                <div class="group-item" data-id="\${group.id}">
                    <div class="download-status" id="status-\${group.id}"></div>
                    <div class="group-info">
                        <h3>\${group.name}</h3>
                        <input type="checkbox" class="group-select" data-id="\${group.id}">
                        <button class="preview-btn" data-id="\${group.id}">Show All Images</button>
                    </div>
                    <div class="group-preview" id="preview-\${group.id}">
                        <div class="preview-grid"></div>
                    </div>
                </div>
            \`).join('');
            
            groupsContainer.innerHTML = html;

            // Check downloaded status for each group
            groups.forEach(group => {
                fetch(\`/api/media/\${group.id}\`)
                    .then(response => response.json())
                    .then(data => {
                        const status = document.getElementById(\`status-\${group.id}\`);
                        if (data.files && data.files.length > 0) {
                            status.classList.add('downloaded');
                        }
                    });
            });

            // Add preview functionality
            document.querySelectorAll('.preview-btn').forEach(button => {
                button.addEventListener('click', function() {
                    const groupId = this.dataset.id;
                    const previewSection = document.getElementById(\`preview-\${groupId}\`);
                    const previewGrid = previewSection.querySelector('.preview-grid');
                    
                    if (previewSection.classList.contains('active')) {
                        previewSection.classList.remove('active');
                        this.textContent = 'Show All Images';
                        return;
                    }
                    
                    this.textContent = 'Hide Images';
                    previewSection.classList.add('active');
                    previewGrid.innerHTML = '<div class="loading-spinner">Loading images...</div>';

                    fetch(\`/api/preview/\${groupId}\`)
                        .then(response => response.json())
                        .then(data => {
                            if (data.images && data.images.length > 0) {
                                previewGrid.innerHTML = data.images
                                    .map(url => \`
                                        <img 
                                            src="\${url}" 
                                            class="preview-image" 
                                            alt="Group Image"
                                            loading="lazy"
                                            onclick="window.open('\${url}', '_blank')"
                                        >
                                    \`).join('');
                            } else {
                                previewGrid.innerHTML = '<p>No images found in this group</p>';
                            }
                        })
                        .catch(error => {
                            console.error('Preview error:', error);
                            previewGrid.innerHTML = '<p>Failed to load images</p>';
                        });
                });
            });

            // Add change listeners to checkboxes
            document.querySelectorAll('.group-select').forEach(checkbox => {
                checkbox.addEventListener('change', updateDownloadButton);
            });
            
            updateDownloadButton();
        }

        function updateDownloadButton() {
            const selectedGroups = document.querySelectorAll('.group-select:checked');
            downloadBtn.disabled = selectedGroups.length === 0;
        }

        // Select/Deselect all functionality
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.group-select').forEach(checkbox => {
                checkbox.checked = true;
            });
            updateDownloadButton();
        });

        deselectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.group-select').forEach(checkbox => {
                checkbox.checked = false;
            });
            updateDownloadButton();
        });

        // Download functionality
        downloadBtn.addEventListener('click', () => {
            const selectedGroups = Array.from(document.querySelectorAll('.group-select:checked'))
                .map(checkbox => checkbox.dataset.id);
            
            if (selectedGroups.length === 0) return;

            fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupIds: selectedGroups })
            })
            .then(() => {
                progressSection.classList.remove('hidden');
                totalGroups.textContent = selectedGroups.length;
            });
        });

        // Socket.io event handlers
        socket.on('log', (data) => {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = data.message;
            logOutput.appendChild(entry);
            logOutput.scrollTop = logOutput.scrollHeight;
        });

        socket.on('downloadStarted', (data) => {
            progressSection.classList.remove('hidden');
            totalGroups.textContent = data.totalGroups;
            currentGroup.textContent = '0';
        });

        socket.on('groupProcessing', (data) => {
            const status = document.getElementById(\`status-\${data.groupId}\`);
            if (status) {
                status.classList.remove('downloaded');
                status.classList.add('downloading');
            }
            currentGroup.textContent = data.current;
            const progress = (data.current / data.total) * 100;
            groupProgressFill.style.width = progress + '%';
        });

        socket.on('mediaProcessing', (data) => {
            totalMedia.textContent = data.total;
            completedMedia.textContent = data.total - data.remaining;
            const progress = ((data.total - data.remaining) / data.total) * 100;
            mediaProgressFill.style.width = progress + '%';
            
            const status = document.getElementById(\`status-\${data.groupId}\`);
            if (status) {
                if (data.remaining === 0) {
                    status.classList.remove('downloading');
                    status.classList.add('downloaded');
                } else {
                    status.classList.remove('downloaded');
                    status.classList.add('downloading');
                }
            }
        });

        socket.on('downloadCompleted', () => {
            // Update all downloading indicators to completed
            document.querySelectorAll('.download-status.downloading').forEach(status => {
                status.classList.remove('downloading');
                status.classList.add('downloaded');
            });
        });
    });
    `;
    fs.writeFileSync(path.join(publicDir, 'app.js'), js);
}
