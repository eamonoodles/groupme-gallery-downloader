document.addEventListener('DOMContentLoaded', function() {
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
          const response = await fetch(`/api/media/${group.id}`);
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
        const response = await fetch(`/api/media/${groupId}`);
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
  });