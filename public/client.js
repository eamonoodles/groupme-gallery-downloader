
        // ... existing code ...
        
        async function showPreviews(groupId) {
            const previewSection = document.getElementById('preview-section');
            const previewGrid = document.getElementById('image-previews');
            
            try {
                const response = await fetch(`/api/preview/${groupId}`);
                const data = await response.json();
                
                previewGrid.innerHTML = data.images
                    .map(url => `
                        <img 
                            src="${url}" 
                            class="preview-image" 
                            alt="Group Image Preview"
                            onclick="window.open('${url}', '_blank')"
                        >
                    `)
                    .join('');
                    
                previewSection.style.display = 'block';
            } catch (error) {
                console.error('Failed to load previews:', error);
            }
        }
        
        function displayGroups(groups) {
            const groupsList = document.getElementById('groups-list');
            groupsList.innerHTML = groups
                .map(group => `
                    <div class="group-item">
                        <div class="group-info">
                            <h3>${group.name}</h3>
                            <p>${group.messages ? group.messages.count : 0} messages</p>
                        </div>
                        <div class="group-actions">
                            <button onclick="showPreviews('${group.id}')" class="preview-btn">
                                Show Previews
                            </button>
                            <button onclick="downloadGroup('${group.id}')" class="download-btn">
                                Download
                            </button>
                        </div>
                    </div>
                `)
                .join('');
        }
        
        // ... existing code ...
    