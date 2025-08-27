# Quick Setup Guide

## 🚀 Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/honeybadger2121-home/Region40bot_translatorbot.git
cd Region40bot_translatorbot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your bot token
# BOT_TOKEN=your_discord_bot_token_here
```

### 4. Run the Bot
```bash
# Start the bot
npm start

# Or start both bot and dashboard
npm run both
```

### 5. Access Dashboard
- URL: http://localhost:3001
- Login: admin / supersecret

## 🔗 Bot Invitation URL Template
```
https://discord.com/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=8589935616&scope=bot%20applications.commands
```

## 📋 Required Discord Bot Permissions
- Send Messages
- Use Slash Commands
- Read Message History
- Connect to Voice Channels
- Speak in Voice Channels
- Manage Roles (for alliance assignment)
- Send Messages in Threads

## 🛡️ Required Discord Intents
- Server Members Intent ✅
- Message Content Intent ✅
- Presence Intent (optional)

## 💡 First Steps After Setup
1. `/verify` - Test the verification system
2. `/profile` - Complete your profile with language preference
3. `/alliance` - Choose an alliance
4. `/setlang english` - Test auto-translation
5. Right-click any message → "Translate Message"

## 📋 Important Legal Documents
Before deploying the bot, please review:
- **[Privacy Policy](PRIVACY_POLICY.md)** - Data collection and privacy practices
- **[Terms of Service](TERMS_OF_SERVICE.md)** - Legal terms and user responsibilities
- Both documents should be made available to your server members

## 🆘 Troubleshooting
- Ensure bot token is correct in .env
- Check Discord Developer Portal for proper intents
- Verify bot has required permissions in your server
- Check console logs for detailed error messages
