# Region40Bot Setup Guide

## 🚀 Quick Start

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

# Edit .env with your bot token and settings
# BOT_TOKEN=your_discord_bot_token_here
# DASH_PORT=3001
# ADMIN_USER=admin
# ADMIN_PASS=supersecret
```

### 4. Run the Bot
```bash
# Start the bot only
npm start

# Start both bot and dashboard
npm run both

# Development mode with warnings
npm run dev
```

### 5. Access Dashboard
- **URL**: http://localhost:3001
- **Login**: admin / supersecret (or your configured credentials)
- **Features**: Real-time statistics, user management, analytics

## 🔗 Bot Invitation

### Direct Invitation Link
**[Add Region40Bot to Your Server](https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8589935616&scope=bot%20applications.commands)**

### Manual URL
```
https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8589935616&scope=bot%20applications.commands
```

## �️ Required Discord Configuration

### Bot Permissions
The bot requires these Discord permissions:
- ✅ **Send Messages** - Bot responses and translations
- ✅ **Use Slash Commands** - All `/` command functionality
- ✅ **Read Message History** - Context menu translation and auto-translation
- ✅ **Manage Roles** - Alliance role assignment during onboarding
- ✅ **Manage Nicknames** - Profile-based nickname updates
- ✅ **Embed Links** - Rich message formatting and embeds
- ✅ **Add Reactions** - Message confirmations and interaction feedback
- ✅ **View Channels** - Access to server structure and channels
- ✅ **Send Messages in Threads** - Thread support for translations

### Required Discord Intents
In Discord Developer Portal, enable these Privileged Gateway Intents:
- ✅ **Server Members Intent** - Required for onboarding new members
- ✅ **Message Content Intent** - Required for translation processing
- ⚠️ **Presence Intent** - Optional (used for smart message deletion timing)

### Discord Developer Portal Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Copy your bot token to the `.env` file
4. Enable required intents in the "Privileged Gateway Intents" section
5. Use the invitation URL to add the bot to your server

## 🔧 Configuration Options

### Environment Variables
Configure these in your `.env` file:

```bash
# Required - Bot Token
BOT_TOKEN=your_discord_bot_token_here
DISCORD_TOKEN=your_discord_bot_token_here  # Alternative name for compatibility

# Dashboard Configuration
DASH_PORT=3001                    # Dashboard port (default: 3001)
ADMIN_USER=admin                  # Dashboard username
ADMIN_PASS=supersecret           # Dashboard password
DASH_ALLOW_IPS=127.0.0.1,::1    # Allowed IP addresses for dashboard

# Optional - Redis for enhanced caching
REDIS_URL=redis://localhost:6379

# Optional - Development settings
GUILD_ID=your_guild_id_here      # For faster command registration during development
```

### Bot Features Configuration
The bot automatically creates and manages:
- **SQLite Database**: `combined_bot.db` for user profiles and settings
- **Log Files**: Daily logs in `/logs` directory for translation and verification activities
- **Translation Cache**: In-memory caching for improved performance
- **Session Management**: User verification and onboarding state tracking

## 🎯 First Steps After Setup

### 1. Test Bot Functionality
```bash
# In Discord, try these commands:
/help                    # View all available commands
/verify                  # Test the verification system
/profile                 # Check your profile status
/setlang english         # Set your language preference
```

### 2. Configure Server Settings
```bash
# Server administrators can use:
/setup                   # Configure bot channels and settings
/autotranslate status    # Check translation status
/stats                   # View server statistics
```

### 3. Test Translation Features
- Right-click any message → "Translate Message" (context menu)
- Set different language preferences and test auto-translation
- Verify translations are sent privately via Direct Messages

### 4. Access Web Dashboard
- Navigate to http://localhost:3001
- Login with your configured credentials
- View real-time statistics and user analytics

## 📋 Bot Features Overview

### 🔐 Onboarding & Verification
- **Human Verification**: CAPTCHA-style verification to prevent spam bots
- **Profile Collection**: In-game name, timezone, and language preferences
- **Alliance Selection**: Role-based alliance/faction assignment
- **Automated Role Management**: Automatic Discord role assignment
- **Direct Message Flow**: Private verification process via DMs

### 🌐 Translation System
- **Private Auto-Translation**: Translations sent privately via Direct Messages
- **25+ Language Support**: Comprehensive language support including:
  - `en` (English), `es` (Spanish), `fr` (French), `de` (German)
  - `it` (Italian), `pt` (Portuguese), `ru` (Russian), `ja` (Japanese)
  - `zh` (Chinese), `ko` (Korean), `ar` (Arabic), `nl` (Dutch)
  - `pl` (Polish), `sv` (Swedish), `no` (Norwegian), and many more
- **Context Menu Translation**: Right-click any message for instant translation
- **Smart Language Detection**: Automatic language detection using Google Translate
- **Privacy-Focused**: No public translation messages in channels

### � Analytics & Management
- **Real-Time Dashboard**: Live statistics and user management
- **Detailed Logging**: Comprehensive logs for translation and verification activities
- **User Analytics**: Alliance distribution, language preferences, activity metrics
- **Automated Reporting**: Hourly statistics and system health reports

## 🆘 Troubleshooting

### Common Issues

**Bot Not Responding:**
- ✅ Verify bot token is correct in `.env` file
- ✅ Check Discord Developer Portal for proper intents
- ✅ Ensure bot has required permissions in your server
- ✅ Check console logs for detailed error messages

**Translation Not Working:**
- ✅ Set language preference using `/setlang <language>`
- ✅ Verify auto-translation is enabled
- ✅ Check if you have Direct Messages enabled (translations sent via DM)
- ✅ Try context menu translation: right-click → "Translate Message"

**Verification Issues:**
- ✅ Ensure bot has "Manage Roles" permission
- ✅ Check that bot role is higher than assigned roles
- ✅ Verify Direct Messages are enabled for verification flow
- ✅ Complete verification process: reply "verify" to bot DM

**Dashboard Access Problems:**
- ✅ Check that dashboard is running on correct port (default: 3001)
- ✅ Verify credentials in `.env` file
- ✅ Ensure IP address is allowed in `DASH_ALLOW_IPS`
- ✅ Check firewall settings for local access

### Debug Commands
```bash
# Check bot status
npm run trace              # Start with full error traces

# View logs
cat logs/translation-$(date +%Y-%m-%d).log    # Today's translation logs
cat logs/verification-$(date +%Y-%m-%d).log   # Today's verification logs

# Database inspection
sqlite3 combined_bot.db ".tables"             # View database tables
sqlite3 combined_bot.db "SELECT * FROM profiles LIMIT 5;"  # Sample data
```

## 📋 Important Legal Information

Before deploying the bot to production servers, ensure you review:

### Required Documentation
- **[Terms of Service](TERMS_OF_SERVICE.md)** - Legal terms and user responsibilities
- **[Privacy Policy](PRIVACY_POLICY.md)** - Data collection and privacy practices
- **[MIT License](LICENSE)** - Open source license terms and conditions

### Compliance Requirements
- Make legal documents available to your server members
- Inform users about data collection and processing
- Ensure compliance with local privacy laws (GDPR, CCPA, etc.)
- Obtain necessary permissions for data processing

### Data Protection Notes
- Message content is temporarily processed for translation (not stored)
- User profiles and preferences stored in encrypted local database
- Translation services provided by Google Translate API
- Comprehensive logging for transparency and debugging

## 🔗 Additional Resources

### Documentation
- **[README.md](README.md)** - Comprehensive project overview
- **[GitHub Repository](https://github.com/honeybadger2121-home/Region40bot_translatorbot)** - Source code and updates
- **[Issues Tracker](https://github.com/honeybadger2121-home/Region40bot_translatorbot/issues)** - Bug reports and feature requests

### Support
- **Discord Commands**: Use `/help` in Discord for command assistance
- **GitHub Issues**: Submit technical issues and feature requests
- **Community Support**: Get help from other users and contributors

---

**Ready to get started? Follow the setup steps above and join thousands of users using Region40Bot for seamless multilingual Discord communities!**
