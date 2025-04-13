
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
            const html = groups.map(group => `
                <div class="group-item" data-id="${group.id}">
                    <div class="download-status" id="status-${group.id}"></div>
                    <div class="group-info">
                        <h3>${group.name}</h3>
                        <input type="checkbox" class="group-select" data-id="${group.id}">
                        <button class="preview-btn" data-id="${group.id}">Show All Images</button>
                    </div>
                    <div class="group-preview" id="preview-${group.id}">
                        <div class="preview-grid"></div>
                    </div>
                </div>
            `).join('');
            
            groupsContainer.innerHTML = html;

            // Check downloaded status for each group
            groups.forEach(group => {
                fetch(`/api/media/${group.id}`)
                    .then(response => response.json())
                    .then(data => {
                        const status = document.getElementById(`status-${group.id}`);
                        if (data.files && data.files.length > 0) {
                            status.classList.add('downloaded');
                        }
                    });
            });

            // Add preview functionality
            document.querySelectorAll('.preview-btn').forEach(button => {
                button.addEventListener('click', function() {
                    const groupId = this.dataset.id;
                    const previewSection = document.getElementById(`preview-${groupId}`);
                    const previewGrid = previewSection.querySelector('.preview-grid');
                    
                    if (previewSection.classList.contains('active')) {
                        previewSection.classList.remove('active');
                        this.textContent = 'Show All Images';
                        return;
                    }
                    
                    this.textContent = 'Hide Images';
                    previewSection.classList.add('active');
                    previewGrid.innerHTML = '<div class="loading-spinner">Loading images...</div>';

                    fetch(`/api/preview/${groupId}`)
                        .then(response => response.json())
                        .then(data => {
                            if (data.images && data.images.length > 0) {
                                previewGrid.innerHTML = data.images
                                    .map(url => `
                                        <img 
                                            src="${url}" 
                                            class="preview-image" 
                                            alt="Group Image"
                                            loading="lazy"
                                            onclick="window.open('${url}', '_blank')"
                                        >
                                    `).join('');
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
            const status = document.getElementById(`status-${data.groupId}`);
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
            
            const status = document.getElementById(`status-${data.groupId}`);
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
    