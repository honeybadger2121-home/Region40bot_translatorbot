# Region40Bot - Discord Translation & Onboarding Bot

A comprehensive Discord bot that combines advanced member onboarding with privacy-focused real-time translation capabilities, creating a complete multilingual community management solution.

## 🌟 Features

### 🔐 Onboarding System
- **CAPTCHA Verification**: Human verification with math problems
- **Profile Collection**: Collects in-game name, timezone, and preferred language
- **Alliance Selection**: Members can choose from predefined alliances
- **Automated Role Assignment**: Based on profile completion and alliance selection
- **Welcome Messages**: Customizable welcome messages for new members

### 🌐 Translation System
- **Flag-Based Translation**: Users can reply to or react with country flag emojis for instant translation
- **150+ Flag Support**: Comprehensive support for country flags including regional variants
- **Dual Input Methods**: Both reply-based and reaction-based translation requests
- **Auto-Deletion**: Translation messages automatically disappear after 45 seconds to keep channels clean
- **Private Translations**: Translations are sent as replies mentioning only the requesting user
- **25+ Language Support**: Comprehensive support including English, Spanish, French, German, Japanese, Chinese, Korean, Arabic, and many more
- **Smart Language Detection**: Automatic language detection with Google Translate API integration
- **Context Menu Translation**: Right-click any message for instant on-demand translation
- **Individual Language Preferences**: Each user sets their own language preference for personalized translations
- **Visual Countdown**: Translation messages show countdown timer before auto-deletion
- **Translation Caching**: Intelligent caching system to reduce API calls and improve performance

### 📊 Comprehensive Analytics & Management
- **Real-Time Web Dashboard**: Live statistics dashboard accessible at localhost:3001
- **User Management Interface**: View and manage user profiles, verification status, and language preferences
- **Alliance Analytics**: Visual charts showing alliance distribution and member engagement
- **Language Usage Statistics**: Track popular languages and translation frequency patterns
- **Live Updates**: WebSocket-powered real-time dashboard updates every 30 seconds
- **Detailed Logging**: Daily log files for translation and verification activities with automatic rotation

### 🛡️ Administrative Tools
- **Server Configuration**: Flexible setup for verification channels, welcome messages, and role management
- **Statistics Commands**: Detailed server statistics and usage analytics accessible via Discord commands
- **Bulk User Management**: Administrative commands for managing multiple users efficiently
- **Automated Reporting**: Scheduled hourly statistics reports and system health monitoring
- **Security Features**: Rate limiting, abuse prevention, and comprehensive audit logging

## 🚀 Quick Start Guide

### Prerequisites
- Node.js 16.9.0 or higher
- Discord Application with Bot Token
- Discord Server with appropriate permissions

### Installation

```bash
# Clone the repository
git clone https://github.com/honeybadger2121-home/Region40bot_translatorbot.git
cd Region40bot_translatorbot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your bot token and preferences
```

### Configuration

Edit the `.env` file with your settings:

```env
# Required - Discord Bot Token
BOT_TOKEN=your_discord_bot_token_here

# Dashboard Configuration
DASH_PORT=3001
ADMIN_USER=admin
ADMIN_PASS=supersecret

# Security Settings
DASH_ALLOW_IPS=127.0.0.1,::1

# Optional - Redis for enhanced performance
REDIS_URL=redis://localhost:6379
```

### Discord Bot Setup

1. **Create Discord Application**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application and bot
   - Copy the bot token to your `.env` file

2. **Enable Required Intents**:
   - ✅ **Server Members Intent** (Required for member onboarding)
   - ✅ **Message Content Intent** (Required for translation processing)
   - ⚠️ **Presence Intent** (Optional - for smart message timing)

3. **Invite Bot to Server**:
   ```
   https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8589935616&scope=bot%20applications.commands
   ```
   **[Click here to add Region40Bot to your server](https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8589935616&scope=bot%20applications.commands)**

### Running the Bot

```bash
# Start bot only
npm start

# Start bot with dashboard
npm run both

# Development mode with detailed logging
npm run dev

# Production mode with full traces
npm run trace
```

### Access Dashboard
- **URL**: http://localhost:3001
- **Credentials**: Use values from your `.env` file
- **Features**: Real-time stats, user management, analytics

## 🎯 Usage Examples

### Member Onboarding
1. **New User Joins**: Bot automatically starts DM verification
2. **Verification Process**: User completes CAPTCHA and profile setup
3. **Profile Information**: In-game name, timezone, language preference
4. **Alliance Selection**: Choose from available server alliances
5. **Role Assignment**: Automatic Discord role assignment based on choices

### Translation Workflow
1. **Flag Translation**: Reply to any message with a country flag emoji (🇺🇸 🇪🇸 🇫🇷 🇩🇪 etc.) OR react to any message with a flag emoji
2. **Instant Translation**: Bot translates the message to the language corresponding to the flag
3. **Auto-Deletion**: Translation appears as a reply mentioning you, then auto-deletes after 45 seconds
4. **150+ Flags Supported**: Works with country flags from around the world, including regional variants
5. **Clean Channels**: No permanent clutter - translations disappear automatically

### Administrative Management
1. **Dashboard Monitoring**: Real-time user and translation statistics
2. **Server Configuration**: Set up channels and preferences
3. **User Management**: View profiles and verification status
4. **Analytics**: Track alliance distribution and language usage

## 🗃️ Database Schema

The bot uses SQLite with the following main tables:

### Profiles Table
```sql
- userId (TEXT PRIMARY KEY)
- verified (INTEGER) - Verification status
- inGameName (TEXT) - User's in-game name
- timezone (TEXT) - User's timezone/country
- language (TEXT) - Preferred language code
- alliance (TEXT) - Selected alliance
- autoTranslate (INTEGER) - Auto-translation enabled
- joinedAt (DATETIME) - Registration timestamp
- profileCompletedAt (DATETIME) - Profile completion timestamp
```

### Guild Settings Table
```sql
- guildId (TEXT PRIMARY KEY)
- autoTranslateEnabled (INTEGER) - Server-wide translation
- targetLanguage (TEXT) - Target language for server translation
- onboardingEnabled (INTEGER) - Onboarding system enabled
- verificationChannelId (TEXT) - Verification channel
- welcomeChannelId (TEXT) - Welcome channel
- modChannelId (TEXT) - Mod notifications channel
```

## 🌍 Supported Languages

The bot supports automatic translation between 25+ languages including:

- **English** (en) - Default
- **Spanish** (es)
- **French** (fr)
- **German** (de)
- **Italian** (it)
- **Portuguese** (pt)
- **Russian** (ru)
- **Japanese** (ja)
- **Chinese** (zh)
- **Korean** (ko)
- **Arabic** (ar)
- **Dutch** (nl)
- **Polish** (pl)
- **Swedish** (sv)
- **Norwegian** (no)
- **Danish** (da)
- **Finnish** (fi)
- **Czech** (cs)
- **Hungarian** (hu)
- **Romanian** (ro)
- **Bulgarian** (bg)
- **Greek** (el)
- **Hebrew** (he)
- **Hindi** (hi)
- **Thai** (th)
- **Vietnamese** (vi)

## 🎯 Usage Examples

### Setting Up Auto-Translation
1. User joins server and completes `/verify`
2. User fills profile with `/profile` and sets language preference
3. Bot automatically enables personal auto-translation
4. All messages in other languages are translated and sent via DM

### Server-Wide Translation
1. Admin runs `/autotranslate enable server`
2. All messages are automatically translated to English
3. Original and translated versions are shown in channel

### Profile Integration
- Language setting in profile automatically enables auto-translation
- Profile language preference is used for all translation features
- Users can update language anytime with `/setlang`

## 🔧 Configuration Options

### Environment Variables
```env
# Required
BOT_TOKEN=your_bot_token
DISCORD_TOKEN=your_bot_token  # Alternative name

# Optional
REDIS_URL=redis://localhost:6379  # For caching
DASH_PORT=3000  # Dashboard port
ADMIN_USER=admin  # Dashboard login
ADMIN_PASS=password  # Dashboard password
DASH_ALLOW_IPS=127.0.0.1,::1  # Allowed IPs for dashboard
GUILD_ID=guild_id  # For faster command registration in dev
```

### Redis Configuration (Optional)
If Redis is available, the bot will use it for enhanced caching:
- Translation cache
- Language detection cache
- Performance metrics

If Redis is not available, the bot gracefully falls back to in-memory caching.

## 📊 Dashboard Access

Access the web dashboard at `http://localhost:3000` (or your configured port).

**Default Login:**
- Username: `admin`
- Password: `supersecret`

The dashboard provides:
- Real-time user statistics
- Alliance distribution charts
- Language usage analytics
- Recent user activity
- Live updates via WebSocket

## 🛠️ Development

### Project Structure
```
Region40bot_translatorbot/
├── index.js              # Main bot file
├── dashboard.js           # Web dashboard server
├── package.json          # Dependencies and scripts
├── .env.example          # Environment template
├── views/
│   └── dashboard.ejs     # Dashboard template
└── combined_bot.db       # SQLite database (auto-created)
```

### Adding New Features
The bot is designed to be modular and extensible:

1. **New Commands**: Add to the `commands` array and implement in `handleSlashCommand()`
2. **New Translation Features**: Extend the translation functions
3. **New Dashboard Features**: Modify `dashboard.js` and `dashboard.ejs`
4. **Database Changes**: Update schema in database initialization section

### Error Handling
- Comprehensive error handling with graceful fallbacks
- Database errors are logged and don't crash the bot
- Translation API failures fall back to original text
- Dashboard errors are caught and logged

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you encounter any issues:

1. Check the console logs for error messages
2. Verify your `.env` configuration
3. Ensure Discord bot permissions are correctly set
4. Check that required intents are enabled
5. Verify database file permissions

## � Legal and Privacy

This bot complies with privacy regulations and Discord's Terms of Service:

- **[Privacy Policy](PRIVACY_POLICY.md)** - How we collect, use, and protect your data
- **[Terms of Service](TERMS_OF_SERVICE.md)** - Legal terms governing bot usage
- **Data Protection** - User data is stored locally and encrypted
- **Open Source** - Full transparency with publicly available source code

### Key Privacy Features:
- ✅ No personal data sold or shared with third parties
- ✅ Minimal data collection (only what's necessary for functionality)
- ✅ User control over translation and profile settings
- ✅ Local data storage with no cloud dependencies
- ✅ Right to data deletion and portability

## �🔮 Roadmap

- [ ] Advanced voice translation with Google Cloud Speech
- [ ] Custom language models for specific gaming terminology
- [ ] Integration with external user databases
- [ ] Mobile-responsive dashboard improvements
- [ ] Real-time translation quality metrics
- [ ] Advanced admin controls and moderation features
- [ ] Multi-server support with centralized dashboard
- [ ] Webhook integrations for external services
