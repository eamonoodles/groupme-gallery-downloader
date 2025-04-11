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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup express app
const app = express();
const PORT = 3456;
let server;
let socketIO;

export function startGUI() {
  // Add open as a dependency in package.json
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

  app.get('/api/groups', async (req, res) => {
    const token = db.getToken();
    if (!token) {
      return res.status(401).json({ error: 'No token available' });
    }

    try {
      const groups = await fetchAvailableGroups(token);
      res.json({ groups });
    } catch (error) {
      res.status(500).json({ error: error.message });
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
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GroupMe Gallery Downloader</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>GroupMe Gallery Downloader</h1>
    </header>
    
    <main>
      <section id="token-section" class="card">
        <h2>API Token</h2>
        <div class="input-group">
          <input type="password" id="token-input" placeholder="Enter your GroupMe API token">
          <button id="save-token-btn">Save Token</button>
        </div>
        <div class="token-info">
          <p><small>Your token is stored locally and never shared.</small></p>
          <p><small>To get your token, visit <a href="https://dev.groupme.com/" target="_blank">https://dev.groupme.com/</a>, login, and click "Access Token".</small></p>
        </div>
      </section>
      
      <section id="groups-section" class="card hidden">
        <h2>Select Groups</h2>
        <div class="loading-spinner" id="groups-loading">Loading groups...</div>
        <div id="groups-container"></div>
        <div class="button-container">
          <button id="select-all-btn">Select All</button>
          <button id="deselect-all-btn">Deselect All</button>
          <button id="download-btn" class="primary-btn">Download Media</button>
        </div>
      </section>
      
      <section id="progress-section" class="card hidden">
        <h2>Download Progress</h2>
        <div id="progress-container">
          <div id="group-progress">
            <p>Processing groups: <span id="current-group">0</span>/<span id="total-groups">0</span></p>
            <div class="progress-bar">
              <div class="progress-fill" id="group-progress-fill"></div>
            </div>
          </div>
          <div id="media-progress">
            <p>Downloading media: <span id="completed-media">0</span>/<span id="total-media">0</span></p>
            <div class="progress-bar">
              <div class="progress-fill" id="media-progress-fill"></div>
            </div>
          </div>
        </div>
        <div class="log-container">
          <h3>Log</h3>
          <div id="log-output"></div>
        </div>
      </section>
      
      <section id="gallery-section" class="card hidden">
        <h2>Downloaded Media</h2>
        <select id="group-selector">
          <option value="">Select a group to view media</option>
        </select>
        <div id="media-container"></div>
      </section>
    </main>
    
    <footer>
      <p>&copy; 2025 GroupMe Gallery Downloader - <a href="https://github.com/TylerK/groupme-gallery-downloader" target="_blank">GitHub</a></p>
    </footer>
  </div>
  
  <script src="/socket.io/socket.io.js"></script>
  <script src="app.js"></script>
</body>
</html>`;

  fs.writeFileSync(path.join(publicDir, 'index.html'), htmlContent);
}

// CSS file for the GUI
function createCSSFile(publicDir) {
  const cssContent = `* {
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
}`;

  fs.writeFileSync(path.join(publicDir, 'styles.css'), cssContent);
}

// Client-side JavaScript for the GUI
function createClientJSFile(publicDir) {
  const jsContent = `document.addEventListener('DOMContentLoaded', function() {
  // DOM Elements
  const tokenInput = document.getElementById('token-input');
  const saveTokenBtn = document.getElementById('save-token-btn');
  const groupsSection = document.getElementById('groups-section');
  const groupsContainer = document.getElementById('groups-container');
  const groupsLoading = document.getElementById('groups-loading');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const downloadBtn = document.getElementById('download-btn');
  const progressSection = document.getElementById('progress-section');
  const currentGroupEl = document.getElementById('current-group');
  const totalGroupsEl = document.getElementById('total-groups');
  const completedMediaEl = document.getElementById('completed-media');
  const totalMediaEl = document.getElementById('total-media');
  const groupProgressFill = document.getElementById('group-progress-fill');
  const mediaProgressFill = document.getElementById('media-progress-fill');
  const logOutput = document.getElementById('log-output');
  const gallerySection = document.getElementById('gallery-section');
  const groupSelector = document.getElementById('group-selector');
  const mediaContainer = document.getElementById('media-container');
  
  // State
  let selectedGroups = [];
  let allGroups = [];
  let socket;
  
  // Initialize
  init();
  
  function init() {
    // Check for saved token
    fetchToken();
    
    // Setup event listeners
    saveTokenBtn.addEventListener('click', handleSaveToken);
    selectAllBtn.addEventListener('click', handleSelectAll);
    deselectAllBtn.addEventListener('click', handleDeselectAll);
    downloadBtn.addEventListener('click', handleDownload);
    groupSelector.addEventListener('change', handleGroupSelect);
    
    // Initialize socket connection
    setupSocket();
  }
  
  function setupSocket() {
    socket = io();
    
    socket.on('connect', () => {
      console.log('Connected to server');
    });
    
    socket.on('log', (data) => {
      addLogEntry(data.message);
    });
    
    socket.on('downloadStarted', (data) => {
      showProgressSection(data);
    });
    
    socket.on('groupProcessing', (data) => {
      updateGroupProgress(data);
    });
    
    socket.on('mediaProcessing', (data) => {
      updateMediaProgress(data);
    });
    
    socket.on('mediaDownloaded', (data) => {
      incrementCompletedMedia();
    });
    
    socket.on('downloadCompleted', () => {
      completeDownload();
    });
    
    socket.on('downloadError', (data) => {
      addLogEntry('Error: ' + data.error, true);
    });
  }
  
  async function fetchToken() {
    try {
      const response = await fetch('/api/token');
      const data = await response.json();
      
      if (data.token) {
        tokenInput.value = data.token;
        fetchGroups();
      }
    } catch (error) {
      console.error('Error fetching token:', error);
    }
  }
  
  async function handleSaveToken() {
    const token = tokenInput.value.trim();
    
    if (!token) {
      alert('Please enter a valid token');
      return;
    }
    
    try {
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token })
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchGroups();
      }
    } catch (error) {
      console.error('Error saving token:', error);
      alert('Failed to save token');
    }
  }
  
  async function fetchGroups() {
    groupsSection.classList.remove('hidden');
    groupsLoading.classList.remove('hidden');
    groupsContainer.innerHTML = '';
    
    try {
      const response = await fetch('/api/groups');
      const data = await response.json();
      
      if (data.groups && data.groups.length > 0) {
        allGroups = data.groups;
        renderGroups(data.groups);
        updateGroupSelector();
      } else {
        groupsContainer.innerHTML = '<p>No groups found. Please check your token.</p>';
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      groupsContainer.innerHTML = '<p>Error fetching groups. Please check your token.</p>';
    } finally {
      groupsLoading.classList.add('hidden');
    }
  }
  
  function renderGroups(groups) {
    const groupsGrid = document.createElement('div');
    groupsGrid.className = 'groups-grid';
    
    groups.forEach(group => {
      const groupItem = document.createElement('div');
      groupItem.className = 'group-item';
      groupItem.dataset.id = group.id;
      groupItem.textContent = group.name;
      
      groupItem.addEventListener('click', () => {
        toggleGroupSelection(groupItem, group.id);
      });
      
      groupsGrid.appendChild(groupItem);
    });
    
    groupsContainer.appendChild(groupsGrid);
  }
  
  function toggleGroupSelection(element, groupId) {
    if (element.classList.contains('selected')) {
      element.classList.remove('selected');
      selectedGroups = selectedGroups.filter(id => id !== groupId);
    } else {
      element.classList.add('selected');
      selectedGroups.push(groupId);
    }
    
    updateDownloadButton();
  }
  
  function updateDownloadButton() {
    downloadBtn.disabled = selectedGroups.length === 0;
  }
  
  function handleSelectAll() {
    const groupItems = document.querySelectorAll('.group-item');
    groupItems.forEach(item => {
      item.classList.add('selected');
      if (!selectedGroups.includes(item.dataset.id)) {
        selectedGroups.push(item.dataset.id);
      }
    });
    updateDownloadButton();
  }
  
  function handleDeselectAll() {
    const groupItems = document.querySelectorAll('.group-item');
    groupItems.forEach(item => {
      item.classList.remove('selected');
    });
    selectedGroups = [];
    updateDownloadButton();
  }
  
  async function handleDownload() {
    if (selectedGroups.length === 0) {
      alert('Please select at least one group');
      return;
    }
    
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ groupIds: selectedGroups })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Progress will be updated via socket events
      }
    } catch (error) {
      console.error('Error starting download:', error);
      alert('Failed to start download');
    }
  }
  
  function showProgressSection(data) {
    groupsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    gallerySection.classList.remove('hidden');
    
    totalGroupsEl.textContent = data.totalGroups;
    currentGroupEl.textContent = '0';
    completedMediaEl.textContent = '0';
    totalMediaEl.textContent = '0';
    groupProgressFill.style.width = '0%';
    mediaProgressFill.style.width = '0%';
    logOutput.innerHTML = '';
    
    addLogEntry('Download started');
  }
  
  function updateGroupProgress(data) {
    currentGroupEl.textContent = data.current;
    const percentage = (data.current / data.total) * 100;
    groupProgressFill.style.width = percentage + '%';
    
    addLogEntry('Processing group ' + data.current + ' of ' + data.total + ' (ID: ' + data.groupId + ')');
  }
  
  function updateMediaProgress(data) {
    totalMediaEl.textContent = data.total;
    completedMediaEl.textContent = data.total - data.remaining;
    const percentage = ((data.total - data.remaining) / data.total) * 100;
    mediaProgressFill.style.width = percentage + '%';
    
    addLogEntry('Found ' + data.total + ' media items to download');
  }
  
  function incrementCompletedMedia() {
    const completed = parseInt(completedMediaEl.textContent) + 1;
    const total = parseInt(totalMediaEl.textContent);
    completedMediaEl.textContent = completed;
    
    const percentage = (completed / total) * 100;
    mediaProgressFill.style.width = percentage + '%';
  }
  
  function completeDownload() {
    addLogEntry('Download completed!', true);
    updateGroupSelector();
  }
  
  function addLogEntry(message, highlight = false) {
    const entry = document.createElement('div');
    entry.className = 'log-entry' + (highlight ? ' highlight' : '');
    entry.textContent = message;
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;
  }
  
  async function updateGroupSelector() {
    // Clear existing options except first
    while (groupSelector.options.length > 1) {
      groupSelector.remove(1);
    }
    
    // Get all downloaded group IDs
    const mediaDir = '../media/';
    try {
      for (const group of allGroups) {
        // Check if we have media for this group
        const response = await fetch(\`/api/media/\${group.id}\`);
        const data = await response.json();
        
        if (data.files && data.files.length > 0) {
          const option = document.createElement('option');
          option.value = group.id;
          option.textContent = group.name;
          groupSelector.appendChild(option);
        }
      }
    } catch (error) {
      console.error('Error updating group selector:', error);
    }
  }
  
  async function handleGroupSelect() {
    const groupId = groupSelector.value;
    
    if (!groupId) {
      mediaContainer.innerHTML = '<p>Select a group to view downloaded media</p>';
      return;
    }
    
    try {
      const response = await fetch(\`/api/media/\${groupId}\`);
      const data = await response.json();
      
      renderMedia(data.files);
    } catch (error) {
      console.error('Error fetching media:', error);
      mediaContainer.innerHTML = '<p>Error loading media</p>';
    }
  }
  
  function renderMedia(files) {
    mediaContainer.innerHTML = '';
    
    if (files.length === 0) {
      mediaContainer.innerHTML = '<p>No media found for this group</p>';
      return;
    }
    
    files.forEach(file => {
      const mediaItem = document.createElement('div');
      mediaItem.className = 'media-item';
      
      if (file.name.match(/(png|jpeg|jpg|gif|bmp|webp)$/i)) {
        // Image
        const img = document.createElement('img');
        img.src = file.path;
        img.alt = file.name;
        mediaItem.appendChild(img);
      } else {
        // Video
        const video = document.createElement('video');
        video.src = file.path;
        video.controls = true;
        video.style.width = '100%';
        video.style.height = '200px';
        mediaItem.appendChild(video);
      }
      
      const info = document.createElement('div');
      info.className = 'media-info';
      info.textContent = file.name;
      mediaItem.appendChild(info);
      
      mediaContainer.appendChild(mediaItem);
    });
  }
});`;

  fs.writeFileSync(path.join(publicDir, 'app.js'), jsContent);
}