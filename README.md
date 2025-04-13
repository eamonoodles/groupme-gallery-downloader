# GroupMe Photo & Video Downloader

Download all photos and videos from your GroupMe groups with just a few clicks!

## Quick Start Guide

### Step 1: Get Your Access Key
1. Go to https://dev.groupme.com/
2. Click "Sign In" and use your regular GroupMe login
3. Click where it says "Access Token"
4. Copy the token (it's like a password - keep it private!)

### Step 2: Download & Setup
1. Open Terminal (MacOS) or Command Prompt (Windows)
2. Type this command and press Enter:
   ```
   git clone https://github.com/eamonday/groupme-gallery-downloader.git
   ```
3. Type this command and press Enter:
   ```
   cd groupme-gallery-downloader
   ```
4. Type this command and press Enter:
   ```
   npm install
   ```
5. Wait for it to finish

### Step 3: Run the Program
Choose one of these options:

#### Easy Way (Recommended)
1. Type `npm run gui` and press Enter
2. A webpage will open
3. Paste your access token
4. Select which groups you want to download from
5. Click "Start Download"

#### Command Line Way
1. Type `npm start` and press Enter
2. Type `1` for command line mode
3. Paste your access token
4. Select a group using arrow keys
5. Press Enter to start downloading

Your photos and videos will be saved in a new folder (inside the groupme-gallery-downloader) folder called "media"!

## Need Help?
- Having trouble? Create an issue on GitHub and we'll help you out, or email me at eamon+gpdl@express-is.net
- Want to run it again later? Just start from Step 3
- If you are on Windows, try running command prompt as administrator (you might be promped for your password)
