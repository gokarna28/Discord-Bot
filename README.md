# Discord QR Code Bot

A Discord bot that processes QR codes from qr1.be and extracts contact information.

## Features
- Reads QR codes from images
- Extracts contact information from qr1.be URLs
- Supports name, phone, email, and address extraction

## Required Files for Railway Deployment
- `main.py` - Main bot code
- `requirements.txt` - Python dependencies
- `Procfile` - Railway deployment configuration
- `runtime.txt` - Specifies Python version (3.11.8)
- `.gitignore` - Prevents sensitive files from being committed

## Environment Variables Required
- `DISCORD_TOKEN` - Your Discord bot token
- `VERIFY_CHANNEL_ID` - Channel ID for verification

## Railway Deployment Steps

1. Fork or clone this repository to your GitHub account

2. Create a new project on [Railway](https://railway.app):
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose this repository
   - Click "Deploy Now"

3. Add Environment Variables in Railway:
   - Go to your project settings
   - Click on "Variables"
   - Add the following variables:
     - `DISCORD_TOKEN`
     - `VERIFY_CHANNEL_ID`

4. Verify Deployment:
   - Railway will automatically deploy your bot
   - Check the deployment logs to ensure everything is running
   - Your bot should show as online in Discord

## Local Development
1. Clone the repository
```bash
git clone [your-repository-url]
cd discord-bot
```

2. Install dependencies
```bash
pip install -r requirements.txt
```

3. Create `.env` file with:
```
DISCORD_TOKEN=your_discord_bot_token
VERIFY_CHANNEL_ID=your_channel_id
```

4. Run the bot
```bash
python main.py
```

## Important Notes
- Never commit your `.env` file
- Keep your Discord token secret
- Make sure all dependencies are in `requirements.txt`
- The bot needs appropriate permissions in your Discord server
