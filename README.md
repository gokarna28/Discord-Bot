# Discord QR Code Bot

A Discord bot that processes QR codes from qr1.be and extracts contact information.

## Features
- Reads QR codes from images
- Extracts contact information from qr1.be URLs
- Supports name, phone, email, and address extraction

## Setup Instructions

1. **Clone the repository**
```bash
git clone [your-repository-url]
cd discord-example-app
```

2. **Install dependencies**
```bash
pip install -r requirements.txt
```

3. **Set up environment variables**
Create a `.env` file in the root directory with:
```
DISCORD_TOKEN=your_discord_bot_token
VERIFY_CHANNEL_ID=your_channel_id
```

4. **Local Development**
```bash
python main.py
```

## Deployment Instructions

### Option 1: Railway.app (Recommended)
1. Create an account on [Railway.app](https://railway.app)
2. Connect your GitHub repository
3. Add environment variables in Railway dashboard
4. Deploy!

### Option 2: Heroku
1. Create a Heroku account
2. Install Heroku CLI
3. Deploy using:
```bash
heroku create
git push heroku main
```
4. Add environment variables in Heroku dashboard

### Option 3: DigitalOcean
1. Create a DigitalOcean account
2. Create a new Droplet
3. SSH into your Droplet
4. Clone repository and follow setup instructions
5. Use PM2 or screen to keep the bot running:
```bash
npm install -g pm2
pm2 start main.py --name "discord-bot"
```

## Important Notes
- Make sure to keep your Discord token secret
- The bot needs appropriate permissions in your Discord server
- For production, consider using a process manager like PM2
- Monitor your bot's logs for any issues
