# Bot Auto-Restart Guide

## 🔄 Automatic Restart Feature

The bot now includes automatic restart functionality to ensure it stays online even if it crashes.

## 📁 Files Created

- `start-bot.ps1` - PowerShell restart script
- `start-bot.bat` - Batch file restart script

## 🚀 How to Use

### Option 1: PowerShell Script (Recommended)
```powershell
# Run in PowerShell
.\start-bot.ps1
```

### Option 2: Batch File
```cmd
# Double-click or run in Command Prompt
start-bot.bat
```

### Option 3: Manual Node.js (No Auto-Restart)
```bash
# Traditional method - no auto-restart
node index.js
```

## ⚙️ Features

- **Auto-Restart**: Automatically restarts if the bot crashes
- **Exit Code Detection**: Differentiates between crashes and graceful shutdowns
- **Restart Limit**: Maximum 50 restart attempts to prevent infinite loops
- **Restart Delay**: 5-second wait between restart attempts
- **Graceful Shutdown**: Use Ctrl+C to stop permanently
- **Logging**: Shows restart attempts and exit codes

## 🛑 Stopping the Bot

- **Temporary Stop**: Ctrl+C in the terminal
- **Permanent Stop**: Ctrl+C twice or close the terminal window

## 📊 Exit Codes

- `0` - Graceful shutdown (no restart)
- `1` - Error/crash (triggers restart)
- `130` - User interrupted with Ctrl+C (no restart)

## 🔧 Configuration

Edit the restart scripts to modify:
- `maxRestarts` - Maximum number of restart attempts
- `restartDelay` - Seconds to wait before restart
- Logging preferences

## 📝 Example Output

```
🚀 Starting bot (Attempt #1)...
✅ Region40Bot#8303 is online!
❌ Bot crashed with exit code: 1
⏱️ Waiting 5 seconds before restart...
🔄 Restarting bot...
🚀 Starting bot (Attempt #2)...
✅ Region40Bot#8303 is online!
```

The bot will now stay online much more reliably!
