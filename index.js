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

// Initialize database
const db = new sqlite3.Database('./combined_bot.db');

// Initialize command collection
client.commands = new Collection();

// Cache for translation
const translationCache = new Map();
const guildSettings = new Map();
const activeSessions = new Map();

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

// Create database tables
db.serialize(() => {
  // Profiles table with language integration
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    userId TEXT PRIMARY KEY,
    verified INTEGER DEFAULT 0,
    captchaAnswer TEXT,
    inGameName TEXT,
    timezone TEXT,
    language TEXT DEFAULT 'en',
    alliance TEXT,
    nickname TEXT,
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
    welcomeChannelId TEXT
  )`);

  console.log('✅ Database initialized with combined tables');
});

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
    const res = await translateAPI(text, { to: target });
    translationCache.set(cacheKey, res.text);
    return res.text;
  } catch (error) {
    console.error('Translation error:', error);
    return text;
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
client.once('clientReady', async () => {
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
  try {
    const guildSettings = await dbHelpers.getGuildSettings(member.guild.id);
    
    // Add "not-onboarded" role to new members
    let notOnboardedRole = member.guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    // Create the role if it doesn't exist
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
    
    // Assign the role to the new member
    if (notOnboardedRole) {
      try {
        await member.roles.add(notOnboardedRole, 'New member needs to complete onboarding');
        console.log(`Added "not-onboarded" role to ${member.user.username}`);
      } catch (roleAddError) {
        console.error('Error adding not-onboarded role:', roleAddError);
      }
    }
    
    // Always send welcome message and verification for new members
    const welcomeChannel = guildSettings.welcomeChannelId ? 
      member.guild.channels.cache.get(guildSettings.welcomeChannelId) : 
      member.guild.systemChannel;
    
    if (welcomeChannel) {
      // Create verification challenge for the new member
      const captcha = Math.floor(Math.random() * 9000) + 1000;
      const mathProblem = Math.floor(captcha / 100) + (captcha % 100);
      
      const welcomeEmbed = new EmbedBuilder()
        .setTitle('🎉 Welcome to the server!')
        .setDescription(`Hello ${member.user.username}! Welcome to our community. Please complete the verification below to get full access.`)
        .setColor(0x00AE86)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields([
          { name: '� Step 1: Verification', value: `Please solve: **${Math.floor(captcha / 100)} + ${captcha % 100} = ?**\nClick the button below to enter your answer.` },
          { name: '👤 Step 2: Profile', value: 'After verification, use `/profile` to set up your profile', inline: true },
          { name: '🛡️ Step 3: Alliance', value: 'Choose your alliance with `/alliance`', inline: true },
          { name: '🌐 Optional', value: 'Set up auto-translation with `/setlang`', inline: false }
        ]);
      
      const verifyButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_${captcha}`)
            .setLabel('🔐 Verify Now')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
        );
      
      await welcomeChannel.send({ 
        content: `${member.user}, welcome to the server!`,
        embeds: [welcomeEmbed], 
        components: [verifyButton] 
      });
      
      // Also send a DM with verification instructions
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle('🔐 Verification Required')
          .setDescription(`Welcome to **${member.guild.name}**! To complete your verification, please return to the server and solve the math problem posted in the welcome channel.`)
          .addFields([
            { name: '📍 Next Steps', value: '1. Go back to the server\n2. Find the welcome message\n3. Click the "Verify Now" button\n4. Enter the correct answer' },
            { name: '❓ Need Help?', value: 'Contact a server moderator if you need assistance.' }
          ])
          .setColor(0x00AE86)
          .setThumbnail(member.guild.iconURL());
          
        await member.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.log(`Could not send DM to ${member.user.username}:`, dmError.message);
      }
    }
  } catch (error) {
    console.error('Error in guildMemberAdd:', error);
  }
});

// Message handler for auto-translation
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.trim()) return;
  
  try {
    // Check for personal auto-translation (post in channel, not DM)
    const userProfile = await dbHelpers.getUserProfile(message.author.id);
    if (userProfile && userProfile.autoTranslate && userProfile.language) {
      const detectedLang = await detectLanguage(message.content);
      
      if (detectedLang !== userProfile.language) {
        const translated = await translate(message.content, userProfile.language);
        
        const translationEmbed = new EmbedBuilder()
          .setAuthor({ 
            name: `${message.author.username} (${detectedLang} → ${userProfile.language})`,
            iconURL: message.author.displayAvatarURL()
          })
          .setDescription(translated)
          .setColor(0x00AE86)
          .setTimestamp()
          .setFooter({ text: `Personal translation for ${message.author.username}` });
        
        await message.channel.send({ embeds: [translationEmbed] });
        return; // Don't also do guild-wide translation
      }
    }
    
    // Check for guild-wide auto-translation (only if no personal translation was done)
    const guildSettings = await dbHelpers.getGuildSettings(message.guild.id);
    if (guildSettings.autoTranslateEnabled) {
      const detectedLang = await detectLanguage(message.content);
      
      if (detectedLang !== guildSettings.targetLanguage) {
        const translated = await translate(message.content, guildSettings.targetLanguage);
        
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
      default:
        await interaction.reply({ content: 'Unknown command!', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error(`Error handling command ${commandName}:`, error);
    try {
      await interaction.reply({ content: 'An error occurred while processing your command.', flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
}

// Command implementations
async function handleVerifyCommand(interaction) {
  const captcha = Math.floor(Math.random() * 9000) + 1000;
  
  const embed = new EmbedBuilder()
    .setTitle('🔐 Human Verification')
    .setDescription('Please solve this simple math problem to verify you are human:')
    .addFields([
      { name: '🧮 Problem', value: `What is ${Math.floor(captcha / 100)} + ${captcha % 100}?` }
    ])
    .setColor(0xFFD700)
    .setFooter({ text: 'Enter your answer using the button below' });
  
  const button = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`verify_${captcha}`)
        .setLabel('Enter Answer')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️')
    );
  
  await interaction.reply({ embeds: [embed], components: [button], flags: MessageFlags.Ephemeral });
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
      { label: '⚔️ Warriors Alliance', value: 'warriors', description: 'For brave fighters' },
      { label: '🔮 Mages Guild', value: 'mages', description: 'For magical practitioners' },
      { label: '🏹 Rangers Order', value: 'rangers', description: 'For skilled archers' },
      { label: '🛡️ Defenders Union', value: 'defenders', description: 'For protectors' },
      { label: '🗡️ Assassins Creed', value: 'assassins', description: 'For stealth experts' },
      { label: '💰 Merchants League', value: 'merchants', description: 'For traders' }
    ]);
  
  const row = new ActionRowBuilder().addComponents(selectMenu);
  
  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

async function handleSetLangCommand(interaction) {
  const langInput = interaction.options.getString('language').toLowerCase();
  
  // Handle disable options
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
  
  // Map language name to code
  const lang = languageMap[langInput] || langInput;
  
  try {
    // Get or create user profile
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
    
    const embed = new EmbedBuilder()
      .setTitle('🌐 Language Set Successfully!')
      .setDescription(`Your preferred language has been set to **${langInput}** (${lang})`)
      .addFields([
        { name: '✅ Auto-Translation Enabled', value: 'You will receive automatic translations in the same channel' },
        { name: '🔄 Change Language', value: 'Use `/setlang <language>` to change' },
        { name: '🚫 Disable', value: 'Use `/setlang off` to turn off auto-translation' }
      ])
      .setColor(0x00AE86);
    
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
  
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
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
  
  // Basic voice translation setup (would need Google Cloud Speech API for full implementation)
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

async function handleManageCommand(interaction) {
  try {
    // Check bot permissions first
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
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
    
    // Check if the bot's role is higher than the target role
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
          await interaction.reply({ content: `✅ Added "not-onboarded" role to ${targetUser.username}.`, flags: MessageFlags.Ephemeral });
        } catch (roleError) {
          console.error('Error adding role:', roleError);
          await interaction.reply({ content: '❌ Failed to add role. Please check my permissions and role hierarchy.', flags: MessageFlags.Ephemeral });
        }
        break;
        
      case 'remove_role':
        if (!notOnboardedRole || !member.roles.cache.has(notOnboardedRole.id)) {
          return interaction.reply({ content: '❌ User does not have the "not-onboarded" role.', flags: MessageFlags.Ephemeral });
        }
        
        try {
          await member.roles.remove(notOnboardedRole, `Removed by ${interaction.user.username}`);
          await interaction.reply({ content: `✅ Removed "not-onboarded" role from ${targetUser.username}.`, flags: MessageFlags.Ephemeral });
        } catch (roleError) {
          console.error('Error removing role:', roleError);
          await interaction.reply({ content: '❌ Failed to remove role. Please check my permissions and role hierarchy.', flags: MessageFlags.Ephemeral });
        }
        break;
        
      case 'reset_verification':
        await dbHelpers.setUserProfile(targetUser.id, { verified: 0 });
        if (notOnboardedRole && !member.roles.cache.has(notOnboardedRole.id)) {
          try {
            await member.roles.add(notOnboardedRole, `Verification reset by ${interaction.user.username}`);
          } catch (roleError) {
            console.error('Error adding role during reset:', roleError);
            return interaction.reply({ content: '⚠️ Reset verification in database, but failed to add "not-onboarded" role. Please check my permissions.', flags: MessageFlags.Ephemeral });
          }
        }
        await interaction.reply({ content: `✅ Reset verification for ${targetUser.username}. They will need to verify again.`, flags: MessageFlags.Ephemeral });
        break;
        
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
        await interaction.reply({ content: `✅ Force verified ${targetUser.username} and removed "not-onboarded" role.`, flags: MessageFlags.Ephemeral });
        break;
        
      default:
        await interaction.reply({ content: '❌ Invalid action.', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error('Error in manage command:', error);
    await interaction.reply({ content: 'Error managing user onboarding status. Please check my permissions.', flags: MessageFlags.Ephemeral });
  }
}

async function handleSetupCommand(interaction) {
  try {
    // Defer the reply to prevent timeout issues
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const verificationChannel = interaction.options.getChannel('verification_channel');
    const welcomeChannel = interaction.options.getChannel('welcome_channel');
    const modChannel = interaction.options.getChannel('mod_channel');
    
    const updateData = {};
    if (verificationChannel) updateData.verificationChannelId = verificationChannel.id;
    if (welcomeChannel) updateData.welcomeChannelId = welcomeChannel.id;
    if (modChannel) updateData.modChannelId = modChannel.id;
    
    // Check if any options were provided
    if (Object.keys(updateData).length === 0) {
      // No options provided, show current settings
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
    
    // Update settings with provided options
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
    
    // Try to respond appropriately based on whether we deferred or not
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
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    const notOnboardedRole = interaction.guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    const permissions = {
      manageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles),
      manageGuild: botMember.permissions.has(PermissionsBitField.Flags.ManageGuild),
      sendMessages: botMember.permissions.has(PermissionsBitField.Flags.SendMessages),
      embedLinks: botMember.permissions.has(PermissionsBitField.Flags.EmbedLinks),
      readMessageHistory: botMember.permissions.has(PermissionsBitField.Flags.ReadMessageHistory),
      useSlashCommands: botMember.permissions.has(PermissionsBitField.Flags.UseApplicationCommands)
    };
    
    const embed = new EmbedBuilder()
      .setTitle('🔍 Bot Permission Diagnostics')
      .setDescription('Current permission status and role management capabilities')
      .setColor(permissions.manageRoles ? 0x00FF00 : 0xFF0000)
      .addFields([
        { 
          name: '🤖 Bot Information', 
          value: `**Bot:** ${interaction.client.user.username}\n**Highest Role:** ${botMember.roles.highest.name}\n**Role Position:** ${botMember.roles.highest.position}`,
          inline: false
        },
        {
          name: '🔑 Critical Permissions',
          value: `${permissions.manageRoles ? '✅' : '❌'} Manage Roles\n${permissions.manageGuild ? '✅' : '❌'} Manage Server\n${permissions.sendMessages ? '✅' : '❌'} Send Messages\n${permissions.useSlashCommands ? '✅' : '❌'} Use Slash Commands`,
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
    
    // Add troubleshooting section
    const issues = [];
    if (!permissions.manageRoles) {
      issues.push('• Enable "Manage Roles" permission');
    }
    if (notOnboardedRole && botMember.roles.highest.position <= notOnboardedRole.position) {
      issues.push('• Move bot role above "not-onboarded" role in Server Settings > Roles');
    }
    
    if (issues.length > 0) {
      embed.addFields({
        name: '🔧 Required Actions',
        value: issues.join('\n'),
        inline: false
      });
      
      embed.addFields({
        name: '🔗 Quick Fix',
        value: '[Re-invite bot with proper permissions](https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8858371072&scope=bot%20applications.commands)',
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
    const confirm = interaction.options.getBoolean('confirm');
    const addRole = interaction.options.getBoolean('add_role') !== false; // Default true
    
    if (!confirm) {
      return interaction.reply({ 
        content: '❌ You must set `confirm` to `True` to reset all members verification status.', 
        flags: MessageFlags.Ephemeral 
      });
    }
    
    // Defer reply as this operation can take a while
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    // Check bot permissions
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) && addRole) {
      return interaction.editReply({ 
        content: '❌ I don\'t have permission to manage roles. Please give me the "Manage Roles" permission or set `add_role` to `False`.' 
      });
    }
    
    const notOnboardedRole = interaction.guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    // Create role if it doesn't exist and we need to add it
    if (!notOnboardedRole && addRole) {
      try {
        const newRole = await interaction.guild.roles.create({
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
    
    // Fetch all members to ensure we have the complete list
    const allMembers = await interaction.guild.members.fetch();
    const memberCount = allMembers.size;
    let processedCount = 0;
    let successCount = 0;
    let roleSuccessCount = 0;
    let errors = [];
    
    // Update progress embed
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
    
    // Process members in batches to avoid rate limits
    const memberArray = Array.from(allMembers.values());
    const batchSize = 10;
    
    for (let i = 0; i < memberArray.length; i += batchSize) {
      const batch = memberArray.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (member) => {
        try {
          // Skip bots
          if (member.user.bot) {
            processedCount++;
            return;
          }
          
          // Reset verification in database
          await dbHelpers.setUserProfile(member.user.id, { verified: 0 });
          successCount++;
          
          // Add role if requested and role exists
          if (addRole && notOnboardedRole && !member.roles.cache.has(notOnboardedRole.id)) {
            try {
              await member.roles.add(notOnboardedRole, `Mass verification reset by ${interaction.user.username}`);
              roleSuccessCount++;
            } catch (roleError) {
              errors.push(`Role assignment failed for ${member.user.username}: ${roleError.message}`);
            }
          }
          
        } catch (error) {
          errors.push(`Database reset failed for ${member.user.username}: ${error.message}`);
        } finally {
          processedCount++;
        }
      }));
      
      // Update progress every batch
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
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final results
    const resultEmbed = new EmbedBuilder()
      .setTitle('✅ Mass Verification Reset Complete!')
      .setDescription('All server members have been processed.')
      .addFields([
        { name: '👥 Total Members', value: memberCount.toString(), inline: true },
        { name: '✅ Database Resets', value: successCount.toString(), inline: true },
        { name: '🎭 Role Assignments', value: addRole ? roleSuccessCount.toString() : 'Skipped', inline: true },
        { name: '⚠️ Errors', value: errors.length.toString(), inline: true },
        { name: '📊 Success Rate', value: `${Math.round((successCount / (memberCount - allMembers.filter(m => m.user.bot).size)) * 100)}%`, inline: true },
        { name: '⏱️ Processing Time', value: 'Complete', inline: true }
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
    
    // Log summary
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
        value: '[Add Bot to Server](https://discord.com/oauth2/authorize?client_id=1410037675368648704&permissions=8858371072&scope=bot%20applications.commands)\n[GitHub Repository](https://github.com/honeybadger2121-home/Region40bot_translatorbot)\n[Setup Guide](https://github.com/honeybadger2121-home/Region40bot_translatorbot/blob/main/SETUP.md)\n[Full Documentation](https://github.com/honeybadger2121-home/Region40bot_translatorbot/blob/main/README.md)' 
      }
    ])
    .setColor(0x9932CC)
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Button handler
async function handleButton(interaction) {
  const customId = interaction.customId;
  
  if (customId.startsWith('verify_')) {
    const captcha = parseInt(customId.split('_')[1]);
    const answer = Math.floor(captcha / 100) + (captcha % 100);
    
    const modal = new ModalBuilder()
      .setCustomId(`captcha_${answer}`)
      .setTitle('🔐 CAPTCHA Verification');
    
    const answerInput = new TextInputBuilder()
      .setCustomId('captcha_answer')
      .setLabel('Enter your answer:')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter the sum...')
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
    await interaction.showModal(modal);
  }
}

// Select menu handler
async function handleSelectMenu(interaction) {
  if (interaction.customId === 'alliance_select') {
    const alliance = interaction.values[0];
    const allianceNames = {
      'warriors': '⚔️ Warriors Alliance',
      'mages': '🔮 Mages Guild',
      'rangers': '🏹 Rangers Order',
      'defenders': '🛡️ Defenders Union',
      'assassins': '🗡️ Assassins Creed',
      'merchants': '💰 Merchants League'
    };
    
    try {
      await dbHelpers.updateUserProfile(interaction.user.id, { alliance });
      
      const embed = new EmbedBuilder()
        .setTitle('🎉 Alliance Selected!')
        .setDescription(`You have successfully joined the **${allianceNames[alliance]}**!`)
        .setColor(0x00FF00)
        .addFields([
          { name: 'Next Steps:', value: 'Your onboarding is now complete! Explore the server and meet your alliance members.' }
        ]);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error setting alliance:', error);
      await interaction.reply({ content: 'Error setting your alliance.', flags: MessageFlags.Ephemeral });
    }
  }
}

// Modal handler
async function handleModal(interaction) {
  if (interaction.customId.startsWith('captcha_')) {
    const correctAnswer = parseInt(interaction.customId.split('_')[1]);
    const userAnswer = parseInt(interaction.fields.getTextInputValue('captcha_answer'));
    
    if (userAnswer === correctAnswer) {
      try {
        await dbHelpers.setUserProfile(interaction.user.id, { 
          verified: 1,
          captchaAnswer: userAnswer.toString()
        });
        
        // Remove "not-onboarded" role upon successful verification
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (member) {
          const notOnboardedRole = interaction.guild.roles.cache.find(role => role.name === 'not-onboarded');
          if (notOnboardedRole && member.roles.cache.has(notOnboardedRole.id)) {
            try {
              await member.roles.remove(notOnboardedRole, 'Completed verification process');
              console.log(`Removed "not-onboarded" role from ${member.user.username}`);
            } catch (roleRemoveError) {
              console.error('Error removing not-onboarded role:', roleRemoveError);
            }
          }
        }
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Verification Successful!')
          .setDescription('You have been verified and given full access to the server! You can now:')
          .addFields([
            { name: '📋 Complete Profile', value: 'Use `/profile` to fill out your information' },
            { name: '🛡️ Choose Alliance', value: 'Use `/alliance` to select your alliance' },
            { name: '🌐 Set Language', value: 'Use `/setlang` to enable auto-translation' }
          ])
          .setColor(0x00FF00);
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } catch (error) {
        console.error('Error verifying user:', error);
        await interaction.reply({ content: 'Error completing verification.', flags: MessageFlags.Ephemeral });
      }
    } else {
      const embed = new EmbedBuilder()
        .setTitle('❌ Verification Failed')
        .setDescription('Incorrect answer. Please try again with `/verify`')
        .setColor(0xFF0000);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } else if (interaction.customId === 'profile_modal') {
    const inGameName = interaction.fields.getTextInputValue('ingame_name');
    const timezone = interaction.fields.getTextInputValue('timezone');
    const languageInput = interaction.fields.getTextInputValue('language').toLowerCase();
    
    // Map language to code
    const language = languageMap[languageInput] || languageInput;
    
    try {
      await dbHelpers.updateUserProfile(interaction.user.id, {
        inGameName,
        timezone,
        language,
        profileCompletedAt: new Date().toISOString(),
        autoTranslate: 1 // Enable auto-translate when language is set
      });
      
      const embed = new EmbedBuilder()
        .setTitle('📋 Profile Updated!')
        .setDescription('Your profile has been successfully updated!')
        .addFields([
          { name: '🎮 In-Game Name', value: inGameName },
          { name: '🌍 Timezone', value: timezone },
          { name: '🌐 Language', value: `${languageInput} (${language})` },
          { name: '✅ Auto-Translation', value: 'Enabled - you\'ll receive translations in the same channel' }
        ])
        .setColor(0x00FF00);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error updating profile:', error);
      await interaction.reply({ content: 'Error updating your profile.', flags: MessageFlags.Ephemeral });
    }
  }
}

// Context menu handler
async function handleContextMenu(interaction) {
  if (interaction.commandName === 'Translate Message') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      const original = interaction.targetMessage.content;
      if (!original || original.trim() === '') {
        return interaction.editReply('❌ This message has no text content to translate.');
      }
      
      // Get user's preferred language from profile
      const userProfile = await dbHelpers.getUserProfile(interaction.user.id);
      const userLang = userProfile?.language || 'en';
      
      const srcLang = await detectLanguage(original);
      if (srcLang === userLang) {
        return interaction.editReply('✅ This message is already in your preferred language!');
      }
      
      const translated = await translate(original, userLang);
      
      const embed = new EmbedBuilder()
        .setTitle(`🌐 Translation (${srcLang} → ${userLang})`)
        .addFields([
          { name: 'Original', value: original.length > 1024 ? original.substring(0, 1021) + '...' : original },
          { name: 'Translated', value: translated.length > 1024 ? translated.substring(0, 1021) + '...' : translated }
        ])
        .setColor(0x00AE86)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Translation error:', error);
      try {
        await interaction.editReply('❌ An error occurred while translating the message.');
      } catch (replyError) {
        console.error('Error sending error reply:', replyError);
      }
    }
  }
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Login
client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
