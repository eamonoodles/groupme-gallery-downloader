# GroupMe Gallery Downloader
Download all of the photos in any group you have access to via command line or graphical interface.

## What you'll need
* An environment capable of running [Node](https://nodejs.org)
* Git installed locally
* Your GroupMe access token

## Where to get your access token
* Go to https://dev.groupme.com/
* Login with your existing GroupMe credentials.
* Click "Access Token" 
* Copy your token to your clipboard

## How to run this program

In terminal or your editor of choice, run the following: 

* `cd` to your desired location. 
* `git clone https://github.com/TylerK/groupme-gallery-downloader.git`
* `cd groupme-gallery-downloader`
* `yarn && yarn start` - or - `npm i && npm start` 

You will be prompted to choose between the command line interface (CLI) or the graphical user interface (GUI). 

### CLI Mode
If you choose the CLI mode, you will be prompted for your GroupMe access token. Paste it in and press enter. Assuming all went well, you will now be able to select a group you have access to. Select a group and you should see a stream of photos filling up a newly created `media` folder.

### GUI Mode
If you choose the GUI mode, a web browser will open with a user-friendly interface. From there you can:

1. Enter your GroupMe access token
2. Select one or multiple groups to download media from
3. Monitor the download progress in real-time
4. View downloaded media organized by group

You can also start the GUI directly by running:
* `yarn gui` - or - `npm run gui`

NOTE: Your access token is stored locally in the `data` folder so you can re-use it later. This folder is ignored by Git, but please do not make it publically available in any way shape or form.  

## Restarting 

Simply run `yarn start` or `npm start` again and select the group you were downloading from, the downloader will pick up where you left off :)

## License
This project is licensed under the MIT License - see the LICENSE.md file for details.