# Combined Discord Bot

A comprehensive Discord bot that combines advanced onboarding features with real-time translation capabilities, creating a complete member management and multilingual communication solution.

## 🌟 Features

### 🔐 Onboarding System
- **CAPTCHA Verification**: Human verification with math problems
- **Profile Collection**: Collects in-game name, timezone, and preferred language
- **Alliance Selection**: Members can choose from predefined alliances
- **Automated Role Assignment**: Based on profile completion and alliance selection
- **Welcome Messages**: Customizable welcome messages for new members

### 🌐 Translation System
- **Auto-Translation**: Automatically translate messages based on user language preferences
- **Personal Translation**: Individual users receive translations via DM
- **Server-wide Translation**: Guild-wide translation to a common language
- **Context Menu Translation**: Right-click any message to translate it
- **Voice Translation**: Real-time voice channel translation (coming soon)
- **Language Detection**: Automatic language detection for all messages
- **Smart Caching**: Efficient translation caching to reduce API calls

### 📊 Dashboard & Analytics
- **Real-time Dashboard**: Web dashboard with live statistics
- **User Management**: View user profiles, verification status, and language preferences
- **Alliance Analytics**: Visual charts showing alliance distribution
- **Language Analytics**: Statistics on language usage and preferences
- **Live Updates**: WebSocket-powered real-time updates

### 🛡️ Admin Features
- **Server Configuration**: Set up verification, welcome, and mod channels
- **Statistics Commands**: View detailed server statistics
- **Bulk User Management**: Admin commands for user management
- **Automated Reporting**: Scheduled statistics reports

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 16.9.0 or higher
- Discord Application with bot token
- Optional: Redis for enhanced caching

### 2. Installation

```bash
# Clone the repository
git clone <repository-url>
cd Region40bot_translatorbot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 3. Configuration

Edit the `.env` file with your bot token:

```env
BOT_TOKEN=your_discord_bot_token_here
DISCORD_TOKEN=your_discord_bot_token_here  # Alternative for compatibility

# Optional Redis configuration
REDIS_URL=redis://localhost:6379

# Dashboard configuration
DASH_PORT=3000
ADMIN_USER=admin
ADMIN_PASS=supersecret
DASH_ALLOW_IPS=127.0.0.1,::1
```

### 4. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Enable the following **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Presence Intent (optional)

4. Invite the bot with this URL template:
```
https://discord.com/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=8589935616&scope=bot%20applications.commands
```

### 5. Running the Bot

```bash
# Start just the bot
npm start

# Start with warning traces (development)
npm run dev

# Start with full deprecation traces (debugging)
npm run trace

# Start just the dashboard
npm run dashboard

# Start both bot and dashboard
npm run both

# Start both with deprecation traces
npm run both-trace
```

## 📋 Commands

### 🔐 Onboarding Commands
- `/verify` - Start the verification process with CAPTCHA
- `/profile` - Complete your profile information (name, timezone, language)
- `/alliance` - Select your alliance from available options

### 🌐 Translation Commands
- `/setlang <language>` - Set your preferred language for auto-translation
- `/getlang` - View your current language settings
- `/autotranslate enable/disable/status` - Configure server-wide translation (Admin only)
- `/startvoice` - Start voice translation (coming soon)
- `/stopvoice` - Stop voice translation (coming soon)

### 🛠️ Admin Commands
- `/stats` - View detailed server statistics
- `/setup` - Configure bot settings (channels, etc.)

### 🖱️ Context Menus
- **Right-click any message** → "Translate Message" - Instantly translate any message

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

## 🔮 Roadmap

- [ ] Advanced voice translation with Google Cloud Speech
- [ ] Custom language models for specific gaming terminology
- [ ] Integration with external user databases
- [ ] Mobile-responsive dashboard improvements
- [ ] Real-time translation quality metrics
- [ ] Advanced admin controls and moderation features
- [ ] Multi-server support with centralized dashboard
- [ ] Webhook integrations for external services
