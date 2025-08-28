require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
  Collection,
  ContextMenuCommandBuilder,
  ApplicationCommandType
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cron = require('node-cron');
const translateAPI = require('@vitalets/google-translate-api');
const { joinVoiceChannel, EndBehaviorType, createAudioReceiver } = require('@discordjs/voice');

// Initialize client with all required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Database initialization
const db = new sqlite3.Database('combined_bot.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    // Create tables if they don't exist
    db.serialize(() => {
        // Profiles table with language integration
        db.run(`CREATE TABLE IF NOT EXISTS profiles (
            userId TEXT PRIMARY KEY,
            verified INTEGER DEFAULT 0,
            inGameName TEXT,
            timezone TEXT,
            language TEXT DEFAULT 'en',
            alliance TEXT,
            nickname TEXT,
            onboardingStep TEXT,
            joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            profileCompletedAt DATETIME,
            autoTranslate INTEGER DEFAULT 0
        )`);

        // Guild settings table
        db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
            guildId TEXT PRIMARY KEY,
            autoTranslateEnabled INTEGER DEFAULT 0,
            targetLanguage TEXT DEFAULT 'en',
            onboardingEnabled INTEGER DEFAULT 1,
            modChannelId TEXT,
            verificationChannelId TEXT,
            welcomeChannelId TEXT,
            logChannelId TEXT,
            onboardingRoleId TEXT
        )`);

        // Schema migration: Add onboardingStep if it doesn't exist
        db.all("PRAGMA table_info(profiles)", (err, columns) => {
            if (err) {
                console.error("Error checking profiles table info:", err);
                return;
            }
            const hasOnboardingStep = columns.some(col => col.name === 'onboardingStep');
            if (!hasOnboardingStep) {
                db.run("ALTER TABLE profiles ADD COLUMN onboardingStep TEXT", (alterErr) => {
                    if (alterErr) {
                        console.error("Error adding onboardingStep column to profiles:", alterErr);
                    } else {
                        console.log("✅ Successfully added 'onboardingStep' column to profiles table.");
                    }
                });
            }
        });

        console.log('✅ Database initialized with combined tables');
    });
  }
});

// Initialize command collection
client.commands = new Collection();

// Cache for translation
const translationCache = new Map();
const guildSettings = new Map();
const activeSessions = new Map();
const recentlyJoined = new Set();

// Language mapping
const languageMap = {
  'english': 'en',
  'spanish': 'es',
  'french': 'fr',
  'german': 'de',
  'italian': 'it',
  'portuguese': 'pt',
  'russian': 'ru',
  'japanese': 'ja',
  'chinese': 'zh',
  'korean': 'ko',
  'arabic': 'ar',
  'dutch': 'nl',
  'polish': 'pl',
  'swedish': 'sv',
  'norwegian': 'no',
  'danish': 'da',
  'finnish': 'fi',
  'czech': 'cs',
  'hungarian': 'hu',
  'romanian': 'ro',
  'bulgarian': 'bg',
  'greek': 'el',
  'hebrew': 'he',
  'hindi': 'hi',
  'thai': 'th',
  'vietnamese': 'vi'
};

// Database helper functions
const dbHelpers = {
  getUserProfile: (userId) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM profiles WHERE userId = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  setUserProfile: (userId, data) => {
    return new Promise((resolve, reject) => {
      const fields = Object.keys(data).join(', ');
      const placeholders = Object.keys(data).map(() => '?').join(', ');
      const values = Object.values(data);
      
      db.run(`INSERT OR REPLACE INTO profiles (userId, ${fields}) VALUES (?, ${placeholders})`, 
        [userId, ...values], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },

  updateUserProfile: (userId, data) => {
    return new Promise((resolve, reject) => {
      const updates = Object.keys(data).map(key => `${key} = ?`).join(', ');
      const values = [...Object.values(data), userId];
      
      db.run(`UPDATE profiles SET ${updates} WHERE userId = ?`, values, function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  },

  getGuildSettings: (guildId) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM guild_settings WHERE guildId = ?', [guildId], (err, row) => {
        if (err) reject(err);
        else resolve(row || { guildId, autoTranslateEnabled: 0, targetLanguage: 'en' });
      });
    });
  },

  setGuildSettings: (guildId, data) => {
    return new Promise((resolve, reject) => {
      const fields = Object.keys(data).join(', ');
      const placeholders = Object.keys(data).map(() => '?').join(', ');
      const values = Object.values(data);
      
      db.run(`INSERT OR REPLACE INTO guild_settings (guildId, ${fields}) VALUES (?, ${placeholders})`, 
        [guildId, ...values], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  }
};

// Translation functions
async function detectLanguage(text) {
  const cacheKey = `detect:${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }
  
  try {
    const res = await translateAPI(text);
    const lang = res.from.language.iso;
    translationCache.set(cacheKey, lang);
    return lang;
  } catch (error) {
    console.error('Language detection error:', error);
    return 'en';
  }
}

async function translate(text, target) {
  const cacheKey = `trans:${text}:${target}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }
  
  try {
    // Clean and validate target language code
    let cleanTarget = target.toLowerCase().trim();
    
    // Remove any trailing punctuation or invalid characters
    cleanTarget = cleanTarget.replace(/[^a-z]/g, '');
    
    // Map common language names to proper codes
    const languageCodeMap = {
      'english': 'en',
      'french': 'fr',
      'spanish': 'es',
      'german': 'de',
      'italian': 'it',
      'portuguese': 'pt',
      'russian': 'ru',
      'japanese': 'ja',
      'chinese': 'zh',
      'korean': 'ko',
      'arabic': 'ar'
    };
    
    // Use mapped code if available, otherwise use cleaned input
    const targetCode = languageCodeMap[cleanTarget] || cleanTarget;
    
    // Validate that we have a proper 2-letter language code
    if (!targetCode || targetCode.length !== 2) {
      console.error(`Invalid target language code: "${target}" -> "${targetCode}"`);
      return text; // Return original text if invalid target
    }
    
    console.log(`Translating to: ${targetCode} (from input: ${target})`);
    
    const res = await translateAPI(text, { to: targetCode });
    translationCache.set(cacheKey, res.text);
    return res.text;
  } catch (error) {
    console.error('Translation error:', error);
    return text; // Return original text on error
  }
}

// Define slash commands
const commands = [
  // Onboarding commands
  {
    name: 'verify',
    description: 'Start the verification process'
  },
  {
    name: 'profile',
    description: 'Complete your profile information'
  },
  {
    name: 'alliance',
    description: 'Select your alliance'
  },
  
  // Translation commands
  {
    name: 'setlang',
    description: 'Set your preferred language for auto-translation',
    options: [{
      name: 'language',
      type: 3, // STRING
      description: 'Language name or code (e.g., english, spanish, fr)',
      required: true
    }]
  },
  {
    name: 'getlang',
    description: 'View your current language settings'
  },
  {
    name: 'autotranslate',
    description: 'Configure auto-translation settings',
    options: [{
      name: 'enable',
      type: 1, // SUB_COMMAND
      description: 'Enable auto-translation',
      options: [{
        name: 'mode',
        type: 3, // STRING
        description: 'Translation mode',
        required: true,
        choices: [
          { name: 'Personal (DM)', value: 'personal' },
          { name: 'Server-wide', value: 'server' }
        ]
      }]
    }, {
      name: 'disable',
      type: 1, // SUB_COMMAND
      description: 'Disable auto-translation'
    }, {
      name: 'status',
      type: 1, // SUB_COMMAND
      description: 'Check auto-translation status'
    }]
  },
  {
    name: 'startvoice',
    description: 'Start voice translation in your current voice channel'
  },
  {
    name: 'stopvoice',
    description: 'Stop voice translation'
  },
  
  // Admin commands
  {
    name: 'stats',
    description: 'View server onboarding statistics',
    defaultMemberPermissions: '0x20' // MANAGE_GUILD
  },
  {
    name: 'manage',
    description: 'Manage user onboarding status',
    defaultMemberPermissions: '0x20', // MANAGE_GUILD
    options: [{
      name: 'user',
      type: 6, // USER
      description: 'User to manage',
      required: true
    }, {
      name: 'action',
      type: 3, // STRING
      description: 'Action to perform',
      required: true,
      choices: [
        { name: 'Add not-onboarded role', value: 'add_role' },
        { name: 'Remove not-onboarded role', value: 'remove_role' },
        { name: 'Reset verification', value: 'reset_verification' },
        { name: 'Force verify', value: 'force_verify' }
      ]
    }]
  },
  {
    name: 'setup',
    description: 'Configure bot settings for this server',
    defaultMemberPermissions: '0x20', // MANAGE_GUILD
    options: [{
      name: 'verification_channel',
      type: 7, // CHANNEL
      description: 'Channel for verification messages'
    }, {
      name: 'welcome_channel',
      type: 7, // CHANNEL
      description: 'Channel for welcome messages'
    }, {
      name: 'mod_channel',
      type: 7, // CHANNEL
      description: 'Channel for mod notifications'
    }]
  },
  
  // Information commands
  {
    name: 'checkperms',
    description: 'Check bot permissions and diagnose role management issues',
    defaultMemberPermissions: '0x20' // MANAGE_GUILD
  },
  {
    name: 'resetall',
    description: 'Reset verification status for all server members (Admin only)',
    defaultMemberPermissions: '0x20', // MANAGE_GUILD
    options: [{
      name: 'confirm',
      type: 5, // BOOLEAN
      description: 'Confirm you want to reset ALL members verification status',
      required: true
    }, {
      name: 'add_role',
      type: 5, // BOOLEAN
      description: 'Also add "not-onboarded" role to all members (default: true)',
      required: false
    }, {
      name: 'send_dm',
      type: 5, // BOOLEAN
      description: 'Send verification DM to all reset members (default: false)',
      required: false
    }]
  },
  {
    name: 'privacy',
    description: 'View the bot\'s privacy policy and data practices'
  },
  {
    name: 'terms',
    description: 'View the bot\'s terms of service'
  },
  {
    name: 'help',
    description: 'Get help with bot commands and features'
  },
  {
    name: 'testlang',
    description: 'Test translation between languages (Admin only)',
    defaultMemberPermissions: '0x20', // MANAGE_GUILD
    options: [{
      name: 'text',
      type: 3, // STRING
      description: 'Text to translate',
      required: true
    }, {
      name: 'from',
      type: 3, // STRING
      description: 'Source language (e.g., fr, es, de)',
      required: true
    }, {
      name: 'to',
      type: 3, // STRING
      description: 'Target language (e.g., en, fr, es)',
      required: true
    }]
  }
];

// Context menu commands
const contextCommands = [
  {
    name: 'Translate Message',
    type: 3 // MESSAGE
  }
];

// Event handlers
client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  
  // Register slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
    
    console.log('🔄 Registering application commands...');
    
    const allCommands = [...commands, ...contextCommands];
    
    const data = await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: allCommands }
    );
    
    console.log(`✅ Successfully registered ${data.length} application commands.`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
  
  // Schedule hourly reports
  cron.schedule('0 * * * *', async () => {
    console.log('📊 Running hourly statistics report...');
    // Implementation for hourly reports
  });
});

// Member join event
client.on('guildMemberAdd', async (member) => {
  // Strong debounce to prevent multiple triggers - check both caches
  const memberKey = `${member.guild.id}-${member.id}`;
  if (recentlyJoined.has(memberKey) || activeSessions.has(memberKey)) {
    console.log(`Duplicate join event blocked for ${member.user.username}`);
    return;
  }
  
  // Add to both caches immediately to prevent any race conditions
  recentlyJoined.add(memberKey);
  activeSessions.set(memberKey, Date.now());
  
  // Clean up after 30 seconds
  setTimeout(() => {
    recentlyJoined.delete(memberKey);
    activeSessions.delete(memberKey);
  }, 30000);

  try {
    console.log(`Processing new member: ${member.user.username} in ${member.guild.name}`);
    
    // Add "not-onboarded" role to new members
    let notOnboardedRole = member.guild.roles.cache.find(role => role.name === 'not-onboarded');
    if (!notOnboardedRole) {
      try {
        notOnboardedRole = await member.guild.roles.create({
          name: 'not-onboarded',
          color: '#FF6B6B',
          reason: 'Auto-created role for new members who need to complete onboarding',
          permissions: []
        });
        console.log(`Created "not-onboarded" role in ${member.guild.name}`);
      } catch (roleError) {
        console.error('Error creating not-onboarded role:', roleError);
      }
    }
    
    if (notOnboardedRole) {
      try {
        await member.roles.add(notOnboardedRole, 'New member needs to complete onboarding');
        console.log(`Added "not-onboarded" role to ${member.user.username}`);
      } catch (roleAddError) {
        console.error('Error adding not-onboarded role:', roleAddError);
      }
    }
    
    // Send welcome DM (only one per member)
    try {
      const dmEmbed = new EmbedBuilder()
        .setTitle('🎉 Welcome to the server!')
        .setDescription(`Hello ${member.user.username}! Welcome to **${member.guild.name}**!\n\nTo get started, simply reply with: **verify**`)
        .addFields([
          { name: '🔐 Step 1', value: 'Reply with "verify" to this message' },
          { name: '👤 Step 2', value: 'Complete your profile setup' },
          { name: '🛡️ Step 3', value: 'Choose your alliance' },
          { name: '🌐 Optional', value: 'Set up auto-translation' }
        ])
        .setColor(0x00AE86)
        .setThumbnail(member.guild.iconURL());
      
      await member.send({ embeds: [dmEmbed] });
      console.log(`Sent welcome DM to ${member.user.username}`);
    } catch (dmError) {
      console.log(`Could not send DM to ${member.user.username}:`, dmError.message);
    }
  } catch (error) {
    console.error('Error in guildMemberAdd:', error);
  }
});

// Message handler for auto-translation and DM verification
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Handle DM verification responses
  if (!message.guild && message.content.trim()) {
    try {
      const userProfile = await dbHelpers.getUserProfile(message.author.id);
      
      // Handle "verify" command for verification and onboarding start
      if (message.content.trim().toLowerCase() === 'verify') {
        if (!userProfile) {
          // Create new profile and start verification
          await dbHelpers.setUserProfile(message.author.id, { 
            verified: 1,
            onboardingStep: 'profile'
          });
          
          // Remove not-onboarded role from all guilds
          for (const guild of client.guilds.cache.values()) {
            try {
              const member = await guild.members.fetch(message.author.id).catch(() => null);
              if (member) {
                const notOnboardedRole = guild.roles.cache.find(role => role.name === 'not-onboarded');
                if (notOnboardedRole && member.roles.cache.has(notOnboardedRole.id)) {
                  await member.roles.remove(notOnboardedRole, 'Completed verification process');
                  console.log(`Removed "not-onboarded" role from ${member.user.username}`);
                }
              }
            } catch (error) {
              console.error(`Error removing role in guild ${guild.name}:`, error);
            }
          }
          
          await startAutomatedOnboarding(message.author);
        } else if (!userProfile.verified) {
          // User exists but not verified - verify them
          await dbHelpers.updateUserProfile(message.author.id, { 
            verified: 1,
            onboardingStep: 'profile'
          });
          
          // Remove not-onboarded role from all guilds
          for (const guild of client.guilds.cache.values()) {
            try {
              const member = await guild.members.fetch(message.author.id).catch(() => null);
              if (member) {
                const notOnboardedRole = guild.roles.cache.find(role => role.name === 'not-onboarded');
                if (notOnboardedRole && member.roles.cache.has(notOnboardedRole.id)) {
                  await member.roles.remove(notOnboardedRole, 'Completed verification process');
                  console.log(`Removed "not-onboarded" role from ${member.user.username}`);
                }
              }
            } catch (error) {
              console.error(`Error removing role in guild ${guild.name}:`, error);
            }
          }
          
          await startAutomatedOnboarding(message.author);
        } else if (!userProfile.onboardingStep || userProfile.onboardingStep === 'pending') {
          // User is verified but hasn't started onboarding yet
          await startAutomatedOnboarding(message.author);
        } else {
          // User is already in onboarding process
          const errorEmbed = new EmbedBuilder()
            .setTitle('ℹ️ Already Started')
            .setDescription('You\'ve already started the onboarding process. Please continue with the current step.')
            .setColor(0x3498DB);
          
          await message.author.send({ embeds: [errorEmbed] });
        }
      } else if (userProfile && userProfile.verified && userProfile.onboardingStep && userProfile.onboardingStep !== 'complete') {
        await handleOnboardingResponse(message.author, message.content.trim());
      }
    } catch (error) {
      console.error('Error handling DM verification:', error);
    }
    return;
  }
  
  // Auto-translation logic for guild messages
  if (!message.guild || !message.content.trim()) return;
  
  try {
    // Get all users in the guild who have auto-translate enabled
    const allProfiles = await new Promise((resolve, reject) => {
      db.all(`SELECT userId, language FROM profiles WHERE autoTranslate = 1 AND language IS NOT NULL`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // Filter to only users who are in this guild
    const guildMembers = await message.guild.members.fetch();
    const usersWithAutoTranslate = allProfiles.filter(profile => 
      guildMembers.has(profile.userId) && profile.userId !== message.author.id // Don't translate for the sender
    );
    
    if (usersWithAutoTranslate.length > 0) {
      const detectedLang = await detectLanguage(message.content);
      
      // Create translations for each user's preferred language
      const languagesNeeded = [...new Set(usersWithAutoTranslate.map(u => u.language))];
      
      for (const targetLang of languagesNeeded) {
        // Skip if detected language matches target language
        if (detectedLang === targetLang) continue;
        
        const translated = await translate(message.content, targetLang);
        
        // Only send translation if it's actually different from the original
        if (translated && translated.toLowerCase() !== message.content.toLowerCase()) {
          const usersForThisLang = usersWithAutoTranslate.filter(u => u.language === targetLang);
          
          // Create a mention string for users who will see this translation
          const mentionString = usersForThisLang.map(u => `<@${u.userId}>`).join(' ');
          
          const translationEmbed = new EmbedBuilder()
            .setAuthor({ 
              name: `${message.author.username} (${detectedLang} → ${targetLang})`,
              iconURL: message.author.displayAvatarURL()
            })
            .setDescription(translated)
            .setColor(0x00AE86)
            .setTimestamp()
            .setFooter({ text: `Auto-translation for ${targetLang} speakers` });
          
          await message.channel.send({ 
            content: mentionString, 
            embeds: [translationEmbed] 
          });
        }
      }
    }
    
    // Server-wide auto-translation (fallback)
    const guildSettings = await dbHelpers.getGuildSettings(message.guild.id);
    if (guildSettings.autoTranslateEnabled && usersWithAutoTranslate.length === 0) {
      const detectedLang = await detectLanguage(message.content);
      
      // Skip translation if detected language matches target language
      if (detectedLang !== guildSettings.targetLanguage) {
        const translated = await translate(message.content, guildSettings.targetLanguage);
        
        // Only send translation if it's actually different from the original
        if (translated && translated.toLowerCase() !== message.content.toLowerCase()) {
          const translationEmbed = new EmbedBuilder()
            .setAuthor({ 
              name: `${message.author.username} (${detectedLang} → ${guildSettings.targetLanguage})`,
              iconURL: message.author.displayAvatarURL()
            })
            .setDescription(translated)
            .setColor(0x00AE86)
            .setTimestamp()
            .setFooter({ text: `Server-wide translation` });
          
          await message.channel.send({ embeds: [translationEmbed] });
        }
      }
    }
  } catch (error) {
    console.error('Error in message auto-translation:', error);
  }
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButton(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModal(interaction);
  } else if (interaction.isMessageContextMenuCommand()) {
    await handleContextMenu(interaction);
  }
});

// Slash command handler
async function handleSlashCommand(interaction) {
  const { commandName } = interaction;
  
  try {
    let commandHandled = true; // Assume command is handled
    switch (commandName) {
      case 'verify':
        await handleVerifyCommand(interaction);
        break;
      case 'profile':
        await handleProfileCommand(interaction);
        break;
      case 'alliance':
        await handleAllianceCommand(interaction);
        break;
      case 'setlang':
        await handleSetLangCommand(interaction);
        break;
      case 'getlang':
        await handleGetLangCommand(interaction);
        break;
      case 'autotranslate':
        await handleAutoTranslateCommand(interaction);
        break;
      case 'startvoice':
        await handleStartVoiceCommand(interaction);
        break;
      case 'stopvoice':
        await handleStopVoiceCommand(interaction);
        break;
      case 'stats':
        await handleStatsCommand(interaction);
        break;
      case 'manage':
        await handleManageCommand(interaction);
        break;
      case 'setup':
        await handleSetupCommand(interaction);
        break;
      case 'privacy':
        await handlePrivacyCommand(interaction);
        break;
      case 'terms':
        await handleTermsCommand(interaction);
        break;
      case 'checkperms':
        await handleCheckPermsCommand(interaction);
        break;
      case 'resetall':
        await handleResetAllCommand(interaction);
        break;
      case 'help':
        await handleHelpCommand(interaction);
        break;
      case 'testlang':
        await handleTestLangCommand(interaction);
        break;
      default:
        commandHandled = false; // Command not found
    }

    if (!commandHandled) {
        await interaction.reply({ content: 'Unknown command!', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error(`Error handling command ${commandName}:`, error);
    try {
        const replyOptions = { content: 'An error occurred while processing your command.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
}

// Command implementations
async function handleVerifyCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('📨 Verification Instructions')
    .setDescription('To verify and start your onboarding process:\n\n**1.** Click on my name (Region40Bot)\n**2.** Send me a direct message\n**3.** Type: `verify`\n**4.** Follow the onboarding steps')
    .addFields([
      { name: '💬 What to do', value: 'Send me a DM with the word "verify"' },
      { name: '🤖 Where to find me', value: 'Click on "Region40Bot" in the member list or this message' },
      { name: '⏰ What happens next', value: 'I\'ll guide you through profile setup and alliance selection' }
    ])
    .setColor(0x00FF00)
    .setFooter({ text: 'Simple verification: Just DM me "verify" to get started!' });
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleProfileCommand(interaction) {
  const userProfile = await dbHelpers.getUserProfile(interaction.user.id);
  
  if (!userProfile || !userProfile.verified) {
    return interaction.reply({ 
      content: '❌ You must complete verification first! Use `/verify` to get started.', 
      flags: MessageFlags.Ephemeral 
    });
  }
  
  const modal = new ModalBuilder()
    .setCustomId('profile_modal')
    .setTitle('📋 Complete Your Profile');
  
  const nameInput = new TextInputBuilder()
    .setCustomId('ingame_name')
    .setLabel('In-Game Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter your in-game name')
    .setRequired(true)
    .setValue(userProfile.inGameName || '');
  
  const timezoneInput = new TextInputBuilder()
    .setCustomId('timezone')
    .setLabel('Timezone/Country')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., EST, PST, UK, Germany')
    .setRequired(true)
    .setValue(userProfile.timezone || '');
  
  const languageInput = new TextInputBuilder()
    .setCustomId('language')
    .setLabel('Preferred Language')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., English, Spanish, French')
    .setRequired(true)
    .setValue(userProfile.language || 'en');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(timezoneInput),
    new ActionRowBuilder().addComponents(languageInput)
  );
  
  await interaction.showModal(modal);
}

async function handleAllianceCommand(interaction) {
  const userProfile = await dbHelpers.getUserProfile(interaction.user.id);
  
  if (!userProfile || !userProfile.verified) {
    return interaction.reply({ 
      content: '❌ You must complete verification first! Use `/verify` to get started.', 
      flags: MessageFlags.Ephemeral 
    });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🛡️ Choose Your Alliance')
    .setDescription('Select the alliance you want to join:')
    .setColor(0x9932CC);
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('alliance_select')
    .setPlaceholder('Choose your alliance...')
    .addOptions([
      { label: 'ANQA', value: 'anqa', description: 'ANQA Alliance' },
      { label: 'SPBG', value: 'spbg', description: 'SPBG Alliance' },
      { label: 'MGXT', value: 'mgxt', description: 'MGXT Alliance' },
      { label: '1ARK', value: '1ark', description: '1ARK Alliance' },
      { label: 'JAXA', value: 'jaxa', description: 'JAXA Alliance' },
      { label: 'JAX2', value: 'jax2', description: 'JAX2 Alliance' },
      { label: 'ANK', value: 'ank', description: 'ANK Alliance' }
    ]);
  
  const row = new ActionRowBuilder().addComponents(selectMenu);
  
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function handleSetLangCommand(interaction) {
  const langInput = interaction.options.getString('language').toLowerCase().trim();
  
  if (['none', 'off', 'disable', 'stop'].includes(langInput)) {
    try {
      await dbHelpers.updateUserProfile(interaction.user.id, { 
        language: 'en', 
        autoTranslate: 0 
      });
      
      const embed = new EmbedBuilder()
        .setTitle('🚫 Auto-Translation Disabled')
        .setDescription('Your auto-translation has been turned off.')
        .setColor(0xFF6B6B);
      
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error disabling translation:', error);
      return interaction.reply({ content: 'Error disabling auto-translation.', flags: MessageFlags.Ephemeral });
    }
  }
  
  // Clean input and get proper language code
  let cleanInput = langInput.replace(/[^a-z]/g, ''); // Remove punctuation
  let lang = languageMap[cleanInput] || cleanInput;
  
  // Validate language code
  const validLanguageCodes = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ko', 'ar', 'nl', 'pl', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro', 'bg', 'el', 'he', 'hi', 'th', 'vi'];
  
  if (!validLanguageCodes.includes(lang)) {
    // Try to find a close match
    const possibleMatches = Object.keys(languageMap).filter(key => key.includes(cleanInput) || cleanInput.includes(key));
    
    if (possibleMatches.length > 0) {
      lang = languageMap[possibleMatches[0]];
    } else {
      const embed = new EmbedBuilder()
        .setTitle('❌ Invalid Language')
        .setDescription(`"${langInput}" is not a supported language.`)
        .addFields([
          { name: 'Supported Languages:', value: 'English (en), French (fr), Spanish (es), German (de), Italian (it), Portuguese (pt), Russian (ru), Japanese (ja), Chinese (zh), Korean (ko), Arabic (ar)' },
          { name: 'Usage:', value: 'Use `/setlang french` or `/setlang fr` for French' }
        ])
        .setColor(0xFF6B6B);
      
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }
  
  try {
    let userProfile = await dbHelpers.getUserProfile(interaction.user.id);
    if (!userProfile) {
      await dbHelpers.setUserProfile(interaction.user.id, { 
        language: lang, 
        autoTranslate: 1 
      });
    } else {
      await dbHelpers.updateUserProfile(interaction.user.id, { 
        language: lang, 
        autoTranslate: 1 
      });
    }
    
    // Get language name for display
    const langName = Object.keys(languageMap).find(key => languageMap[key] === lang) || lang;
    
    const embed = new EmbedBuilder()
      .setTitle('🌐 Language Set Successfully!')
      .setDescription(`Your preferred language has been set to **${langName}** (${lang})`)
      .addFields([
        { name: '✅ Auto-Translation Enabled', value: 'You will receive automatic translations in the same channel' },
        { name: '🔄 Change Language', value: 'Use `/setlang <language>` to change' },
        { name: '🚫 Disable', value: 'Use `/setlang off` to turn off auto-translation' },
        { name: '🧪 Test Translation', value: 'Try right-clicking any message → "Translate Message"' }
      ])
      .setColor(0x00AE86);
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    
    console.log(`Set language for ${interaction.user.username}: ${langInput} -> ${lang}`);
  } catch (error) {
    console.error('Error setting language:', error);
    await interaction.reply({ content: 'Error setting your language preference.', flags: MessageFlags.Ephemeral });
  }
}

async function handleGetLangCommand(interaction) {
  try {
    const userProfile = await dbHelpers.getUserProfile(interaction.user.id);
    
    if (userProfile && userProfile.language && userProfile.autoTranslate) {
      const embed = new EmbedBuilder()
        .setTitle('🌐 Your Language Settings')
        .addFields([
          { name: 'Preferred Language:', value: `**${userProfile.language}** (Auto-translation enabled)` },
          { name: 'Status:', value: '✅ You will receive automatic translations in the same channel' },
          { name: 'Change Language:', value: 'Use `/setlang <language>` to change' },
          { name: 'Disable:', value: 'Use `/setlang off` to turn off auto-translation' }
        ])
        .setColor(0x00AE86);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      const embed = new EmbedBuilder()
        .setTitle('🌐 Language Settings')
        .setDescription('You haven\'t set up auto-translation yet.')
        .addFields([
          { name: 'Set Language:', value: 'Use `/setlang <language>` to enable auto-translation' },
          { name: 'Supported Languages:', value: 'English, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Chinese, Korean, Arabic, and many more!' }
        ])
        .setColor(0xFFD700);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error('Error getting language:', error);
    await interaction.reply({ content: 'Error retrieving your language preference.', flags: MessageFlags.Ephemeral });
  }
}

async function handleAutoTranslateCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  
  // Check if interaction.member exists and has permissions
  if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ 
      content: '❌ You need "Manage Server" permission to use this command.', 
      flags: MessageFlags.Ephemeral 
    });
  }
  
  try {
    switch (subcommand) {
      case 'enable':
        const mode = interaction.options.getString('mode');
        if (mode === 'server') {
          await dbHelpers.setGuildSettings(interaction.guild.id, {
            autoTranslateEnabled: 1,
            targetLanguage: 'en'
          });
          
          const embed = new EmbedBuilder()
            .setTitle('✅ Server-wide Auto-Translation Enabled')
            .setDescription('All messages will now be automatically translated to English.')
            .setColor(0x00AE86);
          
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
          const embed = new EmbedBuilder()
            .setTitle('ℹ️ Personal Auto-Translation')
            .setDescription('Users can enable personal auto-translation using `/setlang <language>`')
            .setColor(0x00AE86);
          
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        break;
        
      case 'disable':
        await dbHelpers.setGuildSettings(interaction.guild.id, {
          autoTranslateEnabled: 0
        });
        
        const disableEmbed = new EmbedBuilder()
          .setTitle('🚫 Server-wide Auto-Translation Disabled')
          .setDescription('Server-wide auto-translation has been turned off.')
          .setColor(0xFF6B6B);
        
        await interaction.reply({ embeds: [disableEmbed], flags: MessageFlags.Ephemeral });
        break;
        
      case 'status':
        const guildSettings = await dbHelpers.getGuildSettings(interaction.guild.id);
        
        const statusEmbed = new EmbedBuilder()
          .setTitle('📊 Auto-Translation Status')
          .addFields([
            { 
              name: 'Server-wide Translation:', 
              value: guildSettings.autoTranslateEnabled ? '✅ Enabled' : '❌ Disabled' 
            },
            { 
              name: 'Target Language:', 
              value: guildSettings.targetLanguage || 'en' 
            },
            { 
              name: 'Personal Translation:', 
              value: 'Users can set with `/setlang`' 
            }
          ])
          .setColor(0x00AE86);
        
        await interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral });
        break;
    }
  } catch (error) {
    console.error('Auto-translate command error:', error);
    await interaction.reply({ content: 'Error configuring auto-translation.', flags: MessageFlags.Ephemeral });
  }
}

async function handleStartVoiceCommand(interaction) {
  const memberVc = interaction.member.voice.channel;
  if (!memberVc) {
    return interaction.reply({ content: '❌ You must be in a voice channel first!', flags: MessageFlags.Ephemeral });
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎤 Voice Translation')
    .setDescription('Voice translation feature is currently in development. Coming soon!')
    .setColor(0xFFD700);
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleStopVoiceCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🛑 Voice Translation Stopped')
    .setDescription('Voice translation has been stopped.')
    .setColor(0xFF6B6B);
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleStatsCommand(interaction) {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`SELECT 
        COUNT(*) as total,
        SUM(verified) as verified,
        SUM(CASE WHEN inGameName IS NOT NULL AND timezone IS NOT NULL AND language IS NOT NULL THEN 1 ELSE 0 END) as profiled,
        SUM(CASE WHEN alliance IS NOT NULL THEN 1 ELSE 0 END) as withAlliance,
        SUM(autoTranslate) as autoTranslateUsers
      FROM profiles`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0]);
      });
    });
    
    const embed = new EmbedBuilder()
      .setTitle('📊 Server Statistics')
      .addFields([
        { name: '👥 Total Users', value: stats.total.toString(), inline: true },
        { name: '✅ Verified', value: stats.verified.toString(), inline: true },
        { name: '📋 Profile Complete', value: stats.profiled.toString(), inline: true },
        { name: '🛡️ Alliance Selected', value: stats.withAlliance.toString(), inline: true },
        { name: '🌐 Auto-Translation Users', value: stats.autoTranslateUsers.toString(), inline: true },
        { name: '📈 Completion Rate', value: `${Math.round((stats.profiled / Math.max(stats.total, 1)) * 100)}%`, inline: true }
      ])
      .setColor(0x00AE86)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Error getting stats:', error);
    await interaction.reply({ content: 'Error retrieving statistics.', flags: MessageFlags.Ephemeral });
  }
}

async function clearUserAlliance(interaction, member) {
  const allianceRoleNames = ['ANQA', 'SPBG', 'MGXT', '1ARK', 'JAXA', 'JAX2', 'ANK'];
  
  await dbHelpers.updateUserProfile(member.user.id, { alliance: null });
  
  const removedRoles = [];
  for (const roleName of allianceRoleNames) {
    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
    if (role && member.roles && member.roles.cache.has(role.id)) {
      try {
        await member.roles.remove(role, 'Alliance cleared during verification reset');
        removedRoles.push(roleName);
      } catch (roleError) {
        console.error(`Error removing alliance role ${roleName}:`, roleError);
      }
    }
  }
  
  try {
    const userProfile = await dbHelpers.getUserProfile(member.user.id);
    if (userProfile && userProfile.inGameName) {
      const baseNickname = userProfile.inGameName;
      const cleanNickname = baseNickname.replace(/^\([A-Z0-9]{3,4}\)\s*/, '');
      if (cleanNickname !== baseNickname && member.setNickname) {
        await member.setNickname(cleanNickname, 'Alliance tag removed during verification reset');
        await dbHelpers.updateUserProfile(member.user.id, { nickname: cleanNickname });
      }
    }
  } catch (nicknameError) {
    console.error('Error clearing alliance tag from nickname:', nicknameError);
  }
  
  return removedRoles;
}

// Helper function to get base nickname for a member
function getBaseNickname(member, userProfile) {
  if (userProfile && userProfile.inGameName) {
    return userProfile.inGameName;
  }
  return member.displayName;
}

// Helper function to set nickname with alliance tag
async function setNicknameWithAlliance(member, allianceTag, userProfile) {
  try {
    // Validate guild and member objects
    if (!member || !member.guild || !member.guild.members) {
      console.error('Invalid member or guild object in setNicknameWithAlliance');
      return;
    }
    
    // Get bot member for permission checking
    const botMember = member.guild.members.cache.get(member.client.user.id);
    
    if (!botMember) {
      console.error('Could not find bot member in guild');
      return;
    }
    
    console.log(`Attempting to set nickname for ${member.user.username} with tag ${allianceTag}`);
    console.log(`Bot permissions: Manage Nicknames = ${botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)}`);
    console.log(`Bot highest role: ${botMember.roles.highest.name} (position: ${botMember.roles.highest.position})`);
    console.log(`Target user highest role: ${member.roles.highest.name} (position: ${member.roles.highest.position})`);
    
    // Check if bot has permission to manage nicknames
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
      console.log(`Missing "Manage Nicknames" permission in ${member.guild.name}, skipping nickname update`);
      return null;
    }
    
    // Check if target is server owner (can't change owner's nickname)
    if (member.id === member.guild.ownerId) {
      console.log(`Cannot change nickname for server owner ${member.user.username}`);
      return null;
    }
    
    // Check if bot's role is high enough to change this member's nickname
    if (member.roles.highest.position >= botMember.roles.highest.position) {
      console.log(`Cannot change nickname for ${member.user.username} - role hierarchy issue (${member.roles.highest.position} >= ${botMember.roles.highest.position})`);
      return null;
    }
    
    const baseNickname = getBaseNickname(member, userProfile);
    const cleanNickname = baseNickname.replace(/^\([A-Z0-9]{3,4}\)\s*/, '');
    const newNickname = `(${allianceTag}) ${cleanNickname}`;
    
    console.log(`Setting nickname: "${member.displayName}" -> "${newNickname}"`);
    
    await member.setNickname(newNickname, `Alliance tag added: ${allianceTag}`);
    await dbHelpers.updateUserProfile(member.user.id, { nickname: newNickname });
    
    console.log(`✅ Successfully set nickname for ${member.user.username}: ${newNickname}`);
    return newNickname;
  } catch (error) {
    if (error.code === 50013) {
      console.log(`❌ Missing permissions to set nickname for ${member.user.username}: ${error.message}`);
      return null;
    } else {
      console.error(`❌ Error setting nickname for ${member.user.username}:`, error);
      return null;
    }
  }
}

async function startAutomatedOnboarding(user) {
  try {
    // Check if already in onboarding process
    const userProfile = await dbHelpers.getUserProfile(user.id);
    if (userProfile && userProfile.verified && userProfile.onboardingStep) {
      console.log(`User ${user.username} already in onboarding process, skipping duplicate`);
      return;
    }
    
    await dbHelpers.updateUserProfile(user.id, { 
      verified: 1,
      onboardingStep: 'profile'
    });
    
    // Remove not-onboarded role from all guilds
    for (const guild of client.guilds.cache.values()) {
      try {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (member) {
          const notOnboardedRole = guild.roles.cache.find(role => role.name === 'not-onboarded');
          if (notOnboardedRole && member.roles.cache.has(notOnboardedRole.id)) {
            await member.roles.remove(notOnboardedRole, 'Completed automated verification');
          }
        }
      } catch (error) {
        console.error(`Error removing role in guild ${guild.name}:`, error);
      }
    }
    
    // Send profile setup message
    const profileEmbed = new EmbedBuilder()
      .setTitle('🎉 Welcome! Let\'s Get You Set Up')
      .setDescription('Perfect! Now let\'s complete your profile setup. Please provide the following information:')
      .addFields([
        { name: '🎮 In-Game Name', value: 'What is your in-game name?' },
        { name: '🌍 Timezone/Country', value: 'What timezone/country are you in? (e.g., EST, PST, UK, Germany)' },
        { name: '🌐 Language', value: 'What is your preferred language? (e.g., English, Spanish, French)' }
      ])
      .setColor(0x00FF00)
      .setFooter({ text: '⏰ Please reply with: IGN | Timezone | Language (separated by | symbol)' });
    
    await user.send({ embeds: [profileEmbed] });
    console.log(`Sent profile setup message to ${user.username}`);
    
  } catch (error) {
    console.error('Error in automated onboarding:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setTitle('⚠️ Onboarding Error')
      .setDescription('There was an error starting your onboarding process. Please contact a server administrator.')
      .setColor(0xFF6B6B);
    
    await user.send({ embeds: [errorEmbed] }).catch(() => {});
  }
}

async function handleOnboardingResponse(user, message) {
  try {
    const userProfile = await dbHelpers.getUserProfile(user.id);
    
    if (userProfile.onboardingStep === 'profile') {
      const parts = message.split('|').map(part => part.trim());
      
      if (parts.length !== 3) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Invalid Format')
          .setDescription('Please use the format: **IGN | Timezone | Language**\n\nExample: `JohnDoe | EST | English`')
          .setColor(0xFF6B6B);
        
        await user.send({ embeds: [errorEmbed] });
        return;
      }
      
      const [inGameName, timezone, languageInput] = parts;
      const language = languageMap[languageInput.toLowerCase()] || languageInput.toLowerCase();
      
      await dbHelpers.updateUserProfile(user.id, {
        inGameName,
        timezone,
        language,
        autoTranslate: 1,
        profileCompletedAt: new Date().toISOString(),
        onboardingStep: 'alliance'
      });
      
      const allianceEmbed = new EmbedBuilder()
        .setTitle('📋 Profile Updated!')
        .setDescription('Perfect! Your profile has been set up successfully.')
        .addFields([
          { name: '🎮 In-Game Name', value: inGameName },
          { name: '🌍 Timezone', value: timezone },
          { name: '🌐 Language', value: `${languageInput} (Auto-translation enabled)` },
          { name: '🛡️ Next Step', value: 'Please choose your alliance from the list below:' }
        ])
        .setColor(0x00AE86);
      
      const allianceOptions = new EmbedBuilder()
        .setTitle('🛡️ Available Alliances')
        .setDescription('Reply with the **number** of your chosen alliance:')
        .addFields([
          { name: '1️⃣ ANQA', value: 'ANQA Alliance', inline: true },
          { name: '2️⃣ SPBG', value: 'SPBG Alliance', inline: true },
          { name: '3️⃣ MGXT', value: 'MGXT Alliance', inline: true },
          { name: '4️⃣ 1ARK', value: '1ARK Alliance', inline: true },
          { name: '5️⃣ JAXA', value: 'JAXA Alliance', inline: true },
          { name: '6️⃣ JAX2', value: 'JAX2 Alliance', inline: true },
          { name: '7️⃣ ANK', value: 'ANK Alliance', inline: true }
        ])
        .setColor(0x9932CC)
        .setFooter({ text: 'Reply with just the number (1-7)' });
      
      await user.send({ embeds: [allianceEmbed, allianceOptions] });
      
    } else if (userProfile.onboardingStep === 'alliance') {
      const allianceNum = parseInt(message.trim());
      const allianceMap = {
        1: { key: 'anqa', name: 'ANQA', tag: 'ANQA' },
        2: { key: 'spbg', name: 'SPBG', tag: 'SPBG' },
        3: { key: 'mgxt', name: 'MGXT', tag: 'MGXT' },
        4: { key: '1ark', name: '1ARK', tag: '1ARK' },
        5: { key: 'jaxa', name: 'JAXA', tag: 'JAXA' },
        6: { key: 'jax2', name: 'JAX2', tag: 'JAX2' },
        7: { key: 'ank', name: 'ANK', tag: 'ANK' }
      };
      
      if (!allianceMap[allianceNum]) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Invalid Selection')
          .setDescription('Please reply with a number from 1-7 to select your alliance.')
          .setColor(0xFF6B6B);
        
        await user.send({ embeds: [errorEmbed] });
        return;
      }
      
      const selectedAlliance = allianceMap[allianceNum];
      
      await dbHelpers.updateUserProfile(user.id, {
        alliance: selectedAlliance.key,
        onboardingStep: 'complete'
      });
      
          for (const guild of client.guilds.cache.values()) {
            try {
              const member = await guild.members.fetch(user.id).catch(() => null);
              if (member) {
                const allianceRole = guild.roles.cache.find(role => role.name === selectedAlliance.name);
                if (allianceRole) {
                  await member.roles.add(allianceRole, `Joined ${selectedAlliance.name} via automated onboarding`);
                }
                
                try {
                  const userProfile = await dbHelpers.getUserProfile(user.id);
                  const newNickname = await setNicknameWithAlliance(member, selectedAlliance.tag, userProfile);
                  
                  if (!newNickname) {
                    console.log(`Could not set nickname for ${member.user.username}, but continuing onboarding`);
                  }
                } catch (nicknameError) {
                  console.error('Error setting nickname in automated onboarding:', nicknameError);
                }
              }
            } catch (error) {
              console.error(`Error applying alliance in guild ${guild.name}:`, error);
            }
          }
          
          const completionEmbed = new EmbedBuilder()
            .setTitle('🎉 Onboarding Complete!')
            .setDescription('Congratulations! Your onboarding is now complete.')
            .addFields([
              { name: '🛡️ Alliance', value: `${selectedAlliance.name} (${selectedAlliance.tag})` },
              { name: '🎭 Role Applied', value: 'Alliance role has been assigned' },
              { name: '🏷️ Nickname', value: `Alliance tag setup attempted` },
              { name: '🌐 Auto-Translation', value: `Enabled for ${userProfile.language}` },
              { name: '✨ What\'s Next?', value: 'You now have full access to all server features! Welcome to the community!' }
            ])
            .setColor(0x00FF00);
      
      await user.send({ embeds: [completionEmbed] });
      
      for (const guild of client.guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(user.id).catch(() => null);
          if (member) {
            const guildSettings = await dbHelpers.getGuildSettings(guild.id);
            const welcomeChannel = guildSettings.welcomeChannelId ? 
              guild.channels.cache.get(guildSettings.welcomeChannelId) : 
              guild.systemChannel;
            
            if (welcomeChannel) {
              const welcomeEmbed = new EmbedBuilder()
                .setTitle('🌟 Welcome to the Community!')
                .setDescription(`Please welcome ${member} who has completed their onboarding!`)
                .addFields([
                  { name: '🎮 In-Game Name', value: userProfile.inGameName, inline: true },
                  { name: '🌍 Timezone/Country', value: userProfile.timezone, inline: true },
                  { name: '🌐 Language', value: userProfile.language, inline: true },
                  { name: '🛡️ Alliance', value: `${selectedAlliance.name} (${selectedAlliance.tag})`, inline: false }
                ])
                .setColor(0x00FF00)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();
              
              await welcomeChannel.send({ embeds: [welcomeEmbed] });
            }
          }
        } catch (error) {
          console.error(`Error sending welcome message in guild ${guild.name}:`, error);
        }
      }
    }
    
  } catch (error) {
    console.error('Error handling onboarding response:', error);
  }
}

async function handleManageCommand(interaction) {
  try {
    if (!interaction.guild || !interaction.guild.members) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return interaction.reply({ 
        content: '❌ I don\'t have permission to manage roles. Please give me the "Manage Roles" permission.', 
        flags: MessageFlags.Ephemeral 
      });
    }
    
    const targetUser = interaction.options.getUser('user');
    const action = interaction.options.getString('action');
    const member = interaction.guild.members.cache.get(targetUser.id);
    
    if (!member) {
      return interaction.reply({ content: '❌ User not found in this server.', flags: MessageFlags.Ephemeral });
    }
    
    const notOnboardedRole = interaction.guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    if (notOnboardedRole && botMember.roles.highest.position <= notOnboardedRole.position) {
      return interaction.reply({ 
        content: '❌ My role is not high enough to manage the "not-onboarded" role. Please move my role above it in the server settings.', 
        flags: MessageFlags.Ephemeral 
      });
    }
    
    switch (action) {
      case 'add_role':
        if (!notOnboardedRole) {
          return interaction.reply({ content: '❌ "not-onboarded" role not found. It will be created when a new member joins.', flags: MessageFlags.Ephemeral });
        }
        
        if (member.roles.cache.has(notOnboardedRole.id)) {
          return interaction.reply({ content: '❌ User already has the "not-onboarded" role.', flags: MessageFlags.Ephemeral });
        }
        
        try {
          await member.roles.add(notOnboardedRole, `Added by ${interaction.user.username}`);
          return interaction.reply({ content: `✅ Added "not-onboarded" role to ${targetUser.username}.`, flags: MessageFlags.Ephemeral });
        } catch (roleError) {
          console.error('Error adding role:', roleError);
          return interaction.reply({ content: '❌ Failed to add role. Please check my permissions and role hierarchy.', flags: MessageFlags.Ephemeral });
        }
        
      case 'remove_role':
        if (!notOnboardedRole || !member.roles.cache.has(notOnboardedRole.id)) {
          return interaction.reply({ content: '❌ User does not have the "not-onboarded" role.', flags: MessageFlags.Ephemeral });
        }
        
        try {
          await member.roles.remove(notOnboardedRole, `Removed by ${interaction.user.username}`);
          return interaction.reply({ content: `✅ Removed "not-onboarded" role from ${targetUser.username}.`, flags: MessageFlags.Ephemeral });
        } catch (roleError) {
          console.error('Error removing role:', roleError);
          return interaction.reply({ content: '❌ Failed to remove role. Please check my permissions and role hierarchy.', flags: MessageFlags.Ephemeral });
        }
        break;
        
      case 'reset_verification':
        await dbHelpers.setUserProfile(targetUser.id, { verified: 0 });
        
        const removedRoles = await clearUserAlliance(interaction, member);
        
        if (notOnboardedRole && !member.roles.cache.has(notOnboardedRole.id)) {
          try {
            await member.roles.add(notOnboardedRole, `Verification reset by ${interaction.user.username}`);
          } catch (roleError) {
            console.error('Error adding role during reset:', roleError);
            return interaction.reply({ content: '⚠️ Reset verification in database, but failed to add "not-onboarded" role. Please check my permissions.', flags: MessageFlags.Ephemeral });
          }
        }
        
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🔄 Verification Reset')
            .setDescription(`Your verification has been reset in **${interaction.guild.name}** by an administrator.`)
            .addFields([
              { name: '✅ How to verify:', value: 'Reply to this DM with the word "verify"' },
              { name: '✨ After verification:', value: 'You\'ll be guided through profile setup, alliance selection, and language preferences' },
              { name: '❓ Need Help?', value: 'Contact a server moderator if you need assistance.' }
            ])
            .setColor(0xFFD700)
            .setThumbnail(interaction.guild.iconURL());
            
          await targetUser.send({ embeds: [dmEmbed] });
          
        } catch (dmError) {
          console.log(`Could not send verification DM to ${targetUser.username}:`, dmError.message);
          return interaction.reply({ content: `⚠️ Reset verification but could not send DM to ${targetUser.username}. They may have DMs disabled.`, flags: MessageFlags.Ephemeral });
        }
        
        let responseMessage = `✅ Reset verification for ${targetUser.username}.`;
        if (removedRoles.length > 0) {
          responseMessage += `\n🔄 Removed alliance roles: ${removedRoles.join(', ')}`;
        }
        responseMessage += `\n📧 Verification DM sent successfully.`;
        
        return interaction.reply({ content: responseMessage, flags: MessageFlags.Ephemeral });
        
      case 'force_verify':
        await dbHelpers.setUserProfile(targetUser.id, { verified: 1 });
        if (notOnboardedRole && member.roles.cache.has(notOnboardedRole.id)) {
          try {
            await member.roles.remove(notOnboardedRole, `Force verified by ${interaction.user.username}`);
          } catch (roleError) {
            console.error('Error removing role during force verify:', roleError);
            return interaction.reply({ content: '⚠️ Force verified in database, but failed to remove "not-onboarded" role. Please check my permissions.', flags: MessageFlags.Ephemeral });
          }
        }
        return interaction.reply({ content: `✅ Force verified ${targetUser.username} and removed "not-onboarded" role.`, flags: MessageFlags.Ephemeral });
        
      default:
        return interaction.reply({ content: '❌ Invalid action.', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error('Error in manage command:', error);
    try {
      await interaction.reply({ content: 'Error managing user onboarding status. Please check my permissions.', flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
}

async function handleSetupCommand(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const verificationChannel = interaction.options.getChannel('verification_channel');
    const welcomeChannel = interaction.options.getChannel('welcome_channel');
    const modChannel = interaction.options.getChannel('mod_channel');
    
    const updateData = {};
    if (verificationChannel) updateData.verificationChannelId = verificationChannel.id;
    if (welcomeChannel) updateData.welcomeChannelId = welcomeChannel.id;
    if (modChannel) updateData.modChannelId = modChannel.id;
    
    if (Object.keys(updateData).length === 0) {
      const currentSettings = await dbHelpers.getGuildSettings(interaction.guild.id);
      
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Current Server Configuration')
        .setDescription('Use `/setup` with channel options to update settings.')
        .setColor(0x00AE86)
        .addFields([
          { 
            name: 'Welcome Channel', 
            value: currentSettings.welcomeChannelId ? `<#${currentSettings.welcomeChannelId}>` : 'Not set (using system channel)', 
            inline: true 
          },
          { 
            name: 'Verification Channel', 
            value: currentSettings.verificationChannelId ? `<#${currentSettings.verificationChannelId}>` : 'Not set', 
            inline: true 
          },
          { 
            name: 'Mod Channel', 
            value: currentSettings.modChannelId ? `<#${currentSettings.modChannelId}>` : 'Not set', 
            inline: true 
          },
          {
            name: 'Usage',
            value: 'Use `/setup verification_channel:#channel` to set verification channel\nUse `/setup welcome_channel:#channel` to set welcome channel\nUse `/setup mod_channel:#channel` to set mod notifications channel'
          }
        ]);
      
      return await interaction.editReply({ embeds: [embed] });
    }
    
    await dbHelpers.setGuildSettings(interaction.guild.id, updateData);
    
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Server Configuration Updated')
      .setDescription('Bot settings have been updated successfully!')
      .setColor(0x00AE86);
    
    if (verificationChannel) {
      embed.addFields({ name: 'Verification Channel', value: `<#${verificationChannel.id}>`, inline: true });
    }
    if (welcomeChannel) {
      embed.addFields({ name: 'Welcome Channel', value: `<#${welcomeChannel.id}>`, inline: true });
    }
    if (modChannel) {
      embed.addFields({ name: 'Mod Channel', value: `<#${modChannel.id}>`, inline: true });
    }
    
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in setup command:', error);
    
    if (interaction.deferred) {
      await interaction.editReply({ content: 'Error updating server settings. Please try again.' });
    } else {
      await interaction.reply({ content: 'Error updating server settings. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }
}

async function handlePrivacyCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🔒 Privacy Policy')
    .setDescription('Our commitment to protecting your privacy and data')
    .addFields([
      { 
        name: '📋 What We Collect', 
        value: '• Discord User ID and username\n• Profile information (name, timezone, language)\n• Translation preferences\n• Usage statistics (anonymized)' 
      },
      { 
        name: '🛡️ How We Protect Data', 
        value: '• Local encrypted storage\n• No third-party data sharing\n• Minimal data collection\n• User control over settings' 
      },
      { 
        name: '👤 Your Rights', 
        value: '• Access your data\n• Correct profile information\n• Delete your data\n• Export your data' 
      },
      { 
        name: '📖 Full Privacy Policy', 
        value: '[View Complete Privacy Policy](https://github.com/honeybadger2121-home/Region40bot_translatorbot/blob/main/PRIVACY_POLICY.md)' 
      }
    ])
    .setColor(0x00AE86)
    .setTimestamp()
    .setFooter({ text: 'Last updated: August 27, 2025' });
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleTermsCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('📜 Terms of Service')
    .setDescription('Terms and conditions for using this bot')
    .addFields([
      { 
        name: '✅ Acceptable Use', 
        value: '• Use for lawful purposes only\n• Respect other users\n• Provide accurate information\n• Follow Discord\'s Terms of Service' 
      },
      { 
        name: '🚫 Prohibited Activities', 
        value: '• Abuse or harassment\n• Sharing inappropriate content\n• Attempting to break the bot\n• Circumventing security measures' 
      },
      { 
        name: '🛡️ Service Limitations', 
        value: '• Service provided "as-is"\n• No guarantee of uptime\n• Translation accuracy may vary\n• Features subject to change' 
      },
      { 
        name: '📖 Full Terms of Service', 
        value: '[View Complete Terms](https://github.com/honeybadger2121-home/Region40bot_translatorbot/blob/main/TERMS_OF_SERVICE.md)' 
      }
    ])
    .setColor(0xFFD700)
    .setTimestamp()
    .setFooter({ text: 'Last updated: August 27, 2025' });
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleCheckPermsCommand(interaction) {
  try {
    // Check if guild and members are available
    if (!interaction.guild || !interaction.guild.members) {
      return interaction.reply({ 
        content: '❌ Unable to access guild information. Please try again.', 
        flags: MessageFlags.Ephemeral 
      });
    }

    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    if (!botMember) {
      return interaction.reply({ 
        content: '❌ Unable to find bot member in this guild.', 
        flags: MessageFlags.Ephemeral 
      });
    }

    const notOnboardedRole = interaction.guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    const permissions = {
      manageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles),
      manageNicknames: botMember.permissions.has(PermissionsBitField.Flags.ManageNicknames),
      manageGuild: botMember.permissions.has(PermissionsBitField.Flags.ManageGuild),
      sendMessages: botMember.permissions.has(PermissionsBitField.Flags.SendMessages),
      embedLinks: botMember.permissions.has(PermissionsBitField.Flags.EmbedLinks),
      readMessageHistory: botMember.permissions.has(PermissionsBitField.Flags.ReadMessageHistory),
      useSlashCommands: botMember.permissions.has(PermissionsBitField.Flags.UseApplicationCommands)
    };
    
    // Get all alliance roles for hierarchy check
    const allianceRoleNames = ['ANQA', 'SPBG', 'MGXT', '1ARK', 'JAXA', 'JAX2', 'ANK'];
    const allianceRoles = allianceRoleNames.map(name => {
      const role = interaction.guild.roles.cache.find(r => r.name === name);
      return role ? {
        name: role.name,
        position: role.position,
        canManage: botMember.roles.highest.position > role.position
      } : null;
    }).filter(Boolean);
    
    const embed = new EmbedBuilder()
      .setTitle('🔍 Bot Permission Diagnostics')
      .setDescription('Current permission status and role management capabilities')
      .setColor(permissions.manageRoles && permissions.manageNicknames ? 0x00FF00 : 0xFF0000)
      .addFields([
        { 
          name: '🤖 Bot Information', 
          value: `**Bot:** ${interaction.client.user.username}\n**Highest Role:** ${botMember.roles.highest.name}\n**Role Position:** ${botMember.roles.highest.position}`,
          inline: false
        },
        {
          name: '🔑 Critical Permissions',
          value: `${permissions.manageRoles ? '✅' : '❌'} Manage Roles\n${permissions.manageNicknames ? '✅' : '❌'} Manage Nicknames\n${permissions.manageGuild ? '✅' : '❌'} Manage Server\n${permissions.sendMessages ? '✅' : '❌'} Send Messages\n${permissions.useSlashCommands ? '✅' : '❌'} Use Slash Commands`,
          inline: true
        },
        {
          name: '📋 Additional Permissions',
          value: `${permissions.embedLinks ? '✅' : '❌'} Embed Links\n${permissions.readMessageHistory ? '✅' : '❌'} Read Message History`,
          inline: true
        }
      ]);
    
    if (notOnboardedRole) {
      const canManageRole = botMember.roles.highest.position > notOnboardedRole.position;
      embed.addFields({
        name: '🎭 "not-onboarded" Role Status',
        value: `**Role exists:** ✅ Yes\n**Role position:** ${notOnboardedRole.position}\n**Can manage:** ${canManageRole ? '✅ Yes' : '❌ No (role hierarchy issue)'}\n**Members with role:** ${notOnboardedRole.members.size}`,
        inline: false
      });
    } else {
      embed.addFields({
        name: '🎭 "not-onboarded" Role Status',
        value: '❌ Role does not exist (will be created when a new member joins)',
        inline: false
      });
    }
    
    if (allianceRoles.length > 0) {
      const allianceStatus = allianceRoles.map(role => 
        `**${role.name}:** Position ${role.position} ${role.canManage ? '✅' : '❌'}`
      ).join('\n');
      
      embed.addFields({
        name: '🛡️ Alliance Roles Status',
        value: allianceStatus,
        inline: false
      });
    }
    
    // Test nickname permissions with the command user
    const canChangeUserNickname = interaction.member.roles.highest.position < botMember.roles.highest.position && interaction.member.id !== interaction.guild.ownerId;
    
    embed.addFields({
      name: '🏷️ Nickname Test',
      value: `**Can change your nickname:** ${canChangeUserNickname ? '✅ Yes' : '❌ No'}\n**Your highest role:** ${interaction.member.roles.highest.name} (${interaction.member.roles.highest.position})\n**Bot highest role:** ${botMember.roles.highest.name} (${botMember.roles.highest.position})`,
      inline: false
    });
    
    const issues = [];
    if (!permissions.manageRoles) {
      issues.push('• Enable "Manage Roles" permission');
    }
    if (!permissions.manageNicknames) {
      issues.push('• Enable "Manage Nicknames" permission');
    }
    if (notOnboardedRole && botMember.roles.highest.position <= notOnboardedRole.position) {
      issues.push('• Move bot role above "not-onboarded" role in Server Settings > Roles');
    }
    if (allianceRoles.some(role => !role.canManage)) {
      issues.push('• Move bot role above alliance roles in Server Settings > Roles');
    }
    
    if (issues.length > 0) {
      embed.addFields({
        name: '🔧 Required Actions',
        value: issues.join('\n'),
        inline: false
      });
      
      embed.addFields({
        name: '🔗 Quick Fix',
        value: '[Re-invite bot with proper permissions](https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8992588800&scope=bot%20applications.commands)',
        inline: false
      });
    } else {
      embed.addFields({
        name: '✅ Status',
        value: 'All permissions are properly configured! Role management should work correctly.',
        inline: false
      });
    }
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Error checking permissions:', error);
    await interaction.reply({ content: 'Error checking bot permissions.', flags: MessageFlags.Ephemeral });
  }
}

async function handleResetAllCommand(interaction) {
  try {
    if (!interaction.guild || !interaction.guild.members) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    
    const confirm = interaction.options.getBoolean('confirm');
    const addRole = interaction.options.getBoolean('add_role') !== false;
    const sendDM = interaction.options.getBoolean('send_dm') || false;
    
    if (!confirm) {
      return interaction.reply({ 
        content: '❌ You must set `confirm` to `True` to reset all members verification status.', 
        flags: MessageFlags.Ephemeral 
      });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    if (!botMember || (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) && addRole)) {
      return interaction.editReply({ 
        content: '❌ I don\'t have permission to manage roles. Please give me the "Manage Roles" permission or set `add_role` to `False`.' 
      });
    }
    
    let notOnboardedRole = interaction.guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    if (!notOnboardedRole && addRole) {
      try {
        notOnboardedRole = await interaction.guild.roles.create({
          name: 'not-onboarded',
          color: '#FF6B6B',
          reason: 'Auto-created for mass verification reset',
          permissions: []
        });
        console.log(`Created "not-onboarded" role for mass reset in ${interaction.guild.name}`);
      } catch (roleError) {
        console.error('Error creating role for mass reset:', roleError);
        return interaction.editReply({ 
          content: '❌ Failed to create "not-onboarded" role. Please create it manually or disable role assignment.' 
        });
      }
    }
    
    const allMembers = await interaction.guild.members.fetch();
    const memberCount = allMembers.size;
    let processedCount = 0;
    let successCount = 0;
    let roleSuccessCount = 0;
    let dmSuccessCount = 0;
    let errors = [];
    
    const progressEmbed = new EmbedBuilder()
      .setTitle('🔄 Resetting All Member Verification...')
      .setDescription('Processing all server members. This may take a few minutes.')
      .addFields([
        { name: 'Total Members', value: memberCount.toString(), inline: true },
        { name: 'Progress', value: '0%', inline: true },
        { name: 'Status', value: 'Starting...', inline: true }
      ])
      .setColor(0xFFD700);
    
    await interaction.editReply({ embeds: [progressEmbed] });
    
    const memberArray = Array.from(allMembers.values());
    const batchSize = 10;
    
    for (let i = 0; i < memberArray.length; i += batchSize) {
      const batch = memberArray.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (member) => {
        try {
          if (member.user.bot) {
            processedCount++;
            return;
          }
          
          await dbHelpers.setUserProfile(member.user.id, { verified: 0 });
          
          try {
            await clearUserAlliance(interaction, member);
          } catch (allianceError) {
            errors.push(`Alliance clear failed for ${member.user.username}: ${allianceError.message}`);
          }
          
          successCount++;
          
          if (addRole && notOnboardedRole && !member.roles.cache.has(notOnboardedRole.id)) {
            try {
              await member.roles.add(notOnboardedRole, `Mass verification reset by ${interaction.user.username}`);
              roleSuccessCount++;
            } catch (roleError) {
              errors.push(`Role assignment failed for ${member.user.username}: ${roleError.message}`);
            }
          }
          
          if (sendDM) {
            try {
              const welcomeMessage = `🌟 Welcome to **${interaction.guild.name}**! 🌟\n\n` +
                `Hey there, ${member.user.username}! Your verification has been reset. Please reply with "verify" to begin.\n\n` +
                `✨ Once verified, you'll have full access to all our channels and features!\n\n` +
                `If you have any questions, feel free to ask our friendly community. We're here to help! 💙`;

              await member.send(welcomeMessage);
              dmSuccessCount++;
            } catch (dmError) {
              errors.push(`DM failed for ${member.user.username}: ${dmError.message}`);
            }
          }
          
        } catch (error) {
          errors.push(`Database reset failed for ${member.user.username}: ${error.message}`);
        } finally {
          processedCount++;
        }
      }));
      
      const progress = Math.round((processedCount / memberCount) * 100);
      const updatedEmbed = new EmbedBuilder()
        .setTitle('🔄 Resetting All Member Verification...')
        .setDescription('Processing all server members. This may take a few minutes.')
        .addFields([
          { name: 'Total Members', value: memberCount.toString(), inline: true },
          { name: 'Progress', value: `${progress}%`, inline: true },
          { name: 'Processed', value: `${processedCount}/${memberCount}`, inline: true }
        ])
        .setColor(0xFFD700);
      
      await interaction.editReply({ embeds: [updatedEmbed] });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const resultEmbed = new EmbedBuilder()
      .setTitle('✅ Mass Verification Reset Complete!')
      .setDescription('All server members have been processed.')
      .addFields([
        { name: '👥 Total Members', value: memberCount.toString(), inline: true },
        { name: '✅ Database Resets', value: successCount.toString(), inline: true },
        { name: '🎭 Role Assignments', value: addRole ? roleSuccessCount.toString() : 'Skipped', inline: true },
        { name: '📨 DMs Sent', value: sendDM ? dmSuccessCount.toString() : 'Skipped', inline: true },
        { name: '⚠️ Errors', value: errors.length.toString(), inline: true },
        { name: '📊 Success Rate', value: `${Math.round((successCount / (memberCount - allMembers.filter(m => m.user.bot).size)) * 100)}%`, inline: true }
      ])
      .setColor(errors.length > 0 ? 0xFF6B6B : 0x00FF00)
      .setTimestamp();
    
    if (errors.length > 0 && errors.length <= 10) {
      resultEmbed.addFields({
        name: '❌ Error Details',
        value: errors.slice(0, 10).join('\n').substring(0, 1024),
        inline: false
      });
    } else if (errors.length > 10) {
      resultEmbed.addFields({
        name: '❌ Error Summary',
        value: `${errors.length} errors occurred. Check console logs for details.`,
        inline: false
      });
    }
    
    await interaction.editReply({ embeds: [resultEmbed] });
    
    console.log(`Mass verification reset completed by ${interaction.user.username} in ${interaction.guild.name}:`);
    console.log(`- Total members: ${memberCount}`);
    console.log(`- Database resets: ${successCount}`);
    console.log(`- Role assignments: ${roleSuccessCount}`);
    console.log(`- Errors: ${errors.length}`);
    
  } catch (error) {
    console.error('Error in resetall command:', error);
    
    if (interaction.deferred) {
      await interaction.editReply({ content: 'Error processing mass verification reset. Please try again.' });
    } else {
      await interaction.reply({ content: 'Error processing mass verification reset. Please try again.', flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleTestLangCommand(interaction) {
  try {
    const text = interaction.options.getString('text');
    const fromLang = interaction.options.getString('from').toLowerCase().trim();
    const toLang = interaction.options.getString('to').toLowerCase().trim();
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    // Clean language codes
    const cleanFromLang = languageMap[fromLang] || fromLang.replace(/[^a-z]/g, '');
    const cleanToLang = languageMap[toLang] || toLang.replace(/[^a-z]/g, '');
    
    console.log(`Testing translation: "${text}" from ${fromLang} (${cleanFromLang}) to ${toLang} (${cleanToLang})`);
    
    // Detect the actual language
    const detectedLang = await detectLanguage(text);
    
    // Perform translation
    const translated = await translate(text, cleanToLang);
    
    const embed = new EmbedBuilder()
      .setTitle('🧪 Translation Test Results')
      .setDescription('Testing translation functionality')
      .addFields([
        { name: '📝 Original Text', value: `\`\`\`${text}\`\`\``, inline: false },
        { name: '🔍 Detected Language', value: detectedLang, inline: true },
        { name: '🎯 Requested From', value: `${fromLang} → ${cleanFromLang}`, inline: true },
        { name: '🎯 Requested To', value: `${toLang} → ${cleanToLang}`, inline: true },
        { name: '🌐 Translated Text', value: `\`\`\`${translated}\`\`\``, inline: false }
      ])
      .setColor(translated !== text ? 0x00AE86 : 0xFFD700)
      .setTimestamp();
    
    // Add status information
    if (detectedLang === cleanToLang) {
      embed.addFields({ name: '⚠️ Note', value: 'Source and target languages are the same - no translation needed', inline: false });
    } else if (translated === text) {
      embed.addFields({ name: '⚠️ Note', value: 'Translation returned original text - may indicate an error or identical content', inline: false });
    } else {
      embed.addFields({ name: '✅ Status', value: 'Translation successful!', inline: false });
    }
    
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Error in test language command:', error);
    
    if (interaction.deferred) {
      await interaction.editReply({ content: `Error testing translation: ${error.message}` });
    } else {
      await interaction.reply({ content: `Error testing translation: ${error.message}`, flags: MessageFlags.Ephemeral });
    }
  }
}

async function handleHelpCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🤖 Bot Help & Commands')
    .setDescription('Complete guide to bot features and commands')
    .addFields([
      { 
        name: '🔐 Onboarding Commands', 
        value: '`/verify` - Start verification process\n`/profile` - Complete your profile\n`/alliance` - Choose your alliance', 
        inline: true 
      },
      { 
        name: '🌐 Translation Commands', 
        value: '`/setlang <language>` - Set your language\n`/getlang` - View current language\n`/autotranslate` - Server translation (Admin)', 
        inline: true 
      },
      { 
        name: '🛠️ Admin Commands', 
        value: '`/stats` - Server statistics\n`/setup` - Configure channels\n`/autotranslate` - Translation settings', 
        inline: true 
      },
      { 
        name: '📋 Info Commands', 
        value: '`/privacy` - Privacy policy\n`/terms` - Terms of service\n`/help` - This help message', 
        inline: true 
      },
      { 
        name: '🖱️ Context Menus', 
        value: 'Right-click any message → "Translate Message"', 
        inline: true 
      },
      { 
        name: '🎯 Getting Started', 
        value: '1. Use `/verify` to get verified\n2. Complete `/profile` with your info\n3. Choose `/alliance`\n4. Set `/setlang` for translations', 
        inline: false 
      },
      { 
        name: '🔗 Useful Links', 
        value: '[Add Bot to Your Server](https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8992588800&scope=bot%20applications.commands)\n[GitHub Repository](https://github.com/honeybadger2121-home/Region40bot_translatorbot)\n[Setup Guide](https://github.com/honeybadger2121-home/Region40bot_translatorbot/blob/main/SETUP.md)\n[Full Documentation](https://github.com/honeybadger2121-home/Region40bot_translatorbot/blob/main/README.md)' 
      }
    ])
    .setColor(0x9932CC)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Button handler
async function handleButton(interaction) {
  const customId = interaction.customId;
  
  if (customId === 'simple_verify') {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Verification Method Updated')
      .setDescription('The verification button is no longer used. Please **send me a direct message** with the word `verify` to complete verification and start onboarding.\n\n**Instructions:**\n1. Click on my name (Region40Bot)\n2. Send me a direct message\n3. Type: `verify`')
      .setColor(0xFFD700);
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else if (customId.startsWith('verify_')) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Verification Method Updated')
      .setDescription('This verification method is no longer used. Please use the `/verify` command to start the new process.')
      .setColor(0xFFD700);
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

// Select menu handler
async function handleSelectMenu(interaction) {
  if (interaction.customId === 'alliance_select') {
    const alliance = interaction.values[0];
    const allianceNames = {
      'anqa': 'ANQA', 'spbg': 'SPBG', 'mgxt': 'MGXT', '1ark': '1ARK',
      'jaxa': 'JAXA', 'jax2': 'JAX2', 'ank': 'ANK'
    };
    const allianceTags = {
      'anqa': 'ANQA', 'spbg': 'SPBG', 'mgxt': 'MGXT', '1ark': '1ARK',
      'jaxa': 'JAXA', 'jax2': 'JAX2', 'ank': 'ANK'
    };
    
    try {
      // Check if guild and member exist
      if (!interaction.guild || !interaction.guild.members) {
        return interaction.reply({ 
          content: '❌ Unable to access guild information. Please try again.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      const member = interaction.guild.members.cache.get(interaction.user.id);
      if (!member) {
        return interaction.reply({ 
          content: '❌ Unable to find your member information in this server.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      const selectedAllianceName = allianceNames[alliance];
      const selectedAllianceTag = allianceTags[alliance];
      
      const allAllianceRoleNames = Object.values(allianceNames);
      for (const roleName of allAllianceRoleNames) {
        const existingRole = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (existingRole && member.roles.cache.has(existingRole.id)) {
          await member.roles.remove(existingRole, 'Switching alliances');
        }
      }
      
      let allianceRole = interaction.guild.roles.cache.find(role => role.name === selectedAllianceName);
      if (!allianceRole) {
        return interaction.reply({ 
          content: `❌ Alliance role "${selectedAllianceName}" not found. Please contact an administrator.`, 
          flags: MessageFlags.Ephemeral 
        });
      }
      
      await member.roles.add(allianceRole, `Joined ${selectedAllianceName}`);
      
      const userProfile = await dbHelpers.getUserProfile(interaction.user.id);
      const newNickname = await setNicknameWithAlliance(member, selectedAllianceTag, userProfile);
      
      await dbHelpers.updateUserProfile(interaction.user.id, { 
        alliance: alliance
      });
      
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Alliance Joined!')
        .setDescription(`You have successfully joined the **${selectedAllianceName}** alliance!`)
        .addFields([
          { name: 'Role Assigned', value: selectedAllianceName, inline: true }
        ])
        .setColor(0x00AE86);
      
      // Only add nickname field if it was successfully set
      if (newNickname) {
        embed.addFields({ name: 'Nickname Updated', value: newNickname, inline: true });
      } else {
        embed.addFields({ name: 'Nickname', value: '⚠️ Could not update (missing permissions)', inline: true });
      }
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error handling alliance selection:', error);
      await interaction.reply({ content: 'Error setting your alliance. Please check my permissions.', flags: MessageFlags.Ephemeral });
    }
  }
}

// Modal handler
async function handleModal(interaction) {
  if (interaction.customId === 'profile_modal') {
    try {
      const inGameName = interaction.fields.getTextInputValue('ingame_name');
      const timezone = interaction.fields.getTextInputValue('timezone');
      const languageInput = interaction.fields.getTextInputValue('language');
      const language = languageMap[languageInput.toLowerCase()] || languageInput.toLowerCase();
      
      await dbHelpers.updateUserProfile(interaction.user.id, {
        inGameName,
        timezone,
        language,
        autoTranslate: 1,
        profileCompletedAt: new Date().toISOString()
      });
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Profile Updated!')
        .setDescription('Your profile has been successfully updated.')
        .addFields([
          { name: 'In-Game Name', value: inGameName, inline: true },
          { name: 'Timezone', value: timezone, inline: true },
          { name: 'Language', value: `${languageInput} (${language})`, inline: true }
        ])
        .setColor(0x00AE86);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error handling profile modal:', error);
      await interaction.reply({ content: 'Error updating your profile.', flags: MessageFlags.Ephemeral });
    }
  } else if (interaction.customId.startsWith('verify_modal_')) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Verification Method Updated')
      .setDescription('This verification method is no longer used. Please use the `/verify` command to start the new process.')
      .setColor(0xFFD700);
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

// Context menu handler
async function handleContextMenu(interaction) {
  if (interaction.commandName === 'Translate Message') {
    try {
      const message = interaction.targetMessage;
      const userProfile = await dbHelpers.getUserProfile(interaction.user.id);
      const targetLang = userProfile ? userProfile.language : 'en';
      
      if (!message.content) {
        return interaction.reply({ content: '❌ Cannot translate an empty message.', flags: MessageFlags.Ephemeral });
      }
      
      const detectedLang = await detectLanguage(message.content);
      
      // Check if source and target languages are the same
      if (detectedLang === targetLang) {
        const embed = new EmbedBuilder()
          .setAuthor({ 
            name: `${message.author.username} said:`,
            iconURL: message.author.displayAvatarURL()
          })
          .setDescription(message.content)
          .addFields({
            name: `Already in ${targetLang}`,
            value: 'No translation needed - message is already in your preferred language!'
          })
          .setColor(0xFFD700)
          .setTimestamp()
          .setFooter({ text: `Language detection for ${interaction.user.username}` });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      
      const translated = await translate(message.content, targetLang);
      
      // Check if translation is actually different
      if (translated.toLowerCase() === message.content.toLowerCase()) {
        const embed = new EmbedBuilder()
          .setAuthor({ 
            name: `${message.author.username} said:`,
            iconURL: message.author.displayAvatarURL()
          })
          .setDescription(message.content)
          .addFields({
            name: `Already in ${targetLang}`,
            value: 'No translation needed - content is already in the target language!'
          })
          .setColor(0xFFD700)
          .setTimestamp()
          .setFooter({ text: `Translation check for ${interaction.user.username}` });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      
      const embed = new EmbedBuilder()
        .setAuthor({ 
          name: `${message.author.username} said:`,
          iconURL: message.author.displayAvatarURL()
        })
        .setDescription(message.content)
        .addFields({
          name: `Translated to ${targetLang} (from ${detectedLang})`,
          value: translated
        })
        .setColor(0x00AE86)
        .setTimestamp()
        .setFooter({ text: `Translated for ${interaction.user.username}` });
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error handling context menu translation:', error);
      await interaction.reply({ content: 'Error translating message.', flags: MessageFlags.Ephemeral });
    }
  }
}

// Login to Discord
client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
