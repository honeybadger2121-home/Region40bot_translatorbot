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
const fs = require('fs');
const cron = require('node-cron');
const translateAPI = require('@vitalets/google-translate-api');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Logging functions
function logTranslation(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  
  // Console log
  console.log(`[TRANSLATION] ${message}`);
  
  // File log
  const logFile = path.join(logsDir, `translation-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry);
}

function logVerification(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  
  // Console log
  console.log(`[VERIFICATION] ${message}`);
  
  // File log
  const logFile = path.join(logsDir, `verification-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry);
}

// Initialize client with all required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions
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
            devChannelId TEXT,
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

        // Schema migration: Add devChannelId if it doesn't exist
        db.all("PRAGMA table_info(guild_settings)", (err, columns) => {
            if (err) {
                console.error("Error checking guild_settings table info:", err);
                return;
            }
            const hasDevChannelId = columns.some(col => col.name === 'devChannelId');
            if (!hasDevChannelId) {
                db.run("ALTER TABLE guild_settings ADD COLUMN devChannelId TEXT", (alterErr) => {
                    if (alterErr) {
                        console.error("Error adding devChannelId column to guild_settings:", alterErr);
                    } else {
                        console.log("✅ Successfully added 'devChannelId' column to guild_settings table.");
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
  // English variants
  'english': 'en',
  'english.': 'en',
  'eng': 'en',
  'englisch': 'en',
  'inglés': 'en',
  'anglais': 'en',
  'inglese': 'en',
  'inglês': 'en',
  
  // Spanish variants
  'spanish': 'es',
  'español': 'es',
  'espanol': 'es',
  'espagnol': 'es',
  'spagnolo': 'es',
  'espanhol': 'es',
  'castellano': 'es',
  'castilian': 'es',
  
  // French variants
  'french': 'fr',
  'français': 'fr',
  'francais': 'fr',
  'französisch': 'fr',
  'francese': 'fr',
  'francês': 'fr',
  
  // German variants
  'german': 'de',
  'deutsch': 'de',
  'allemand': 'de',
  'tedesco': 'de',
  'alemão': 'de',
  'alemán': 'de',
  
  // Italian variants
  'italian': 'it',
  'italiano': 'it',
  'italienisch': 'it',
  'italien': 'it',
  
  // Portuguese variants
  'portuguese': 'pt',
  'português': 'pt',
  'portugues': 'pt',
  'portugiesisch': 'pt',
  'portugais': 'pt',
  'brasiliano': 'pt',
  'brasileiro': 'pt',
  
  // Russian variants
  'russian': 'ru',
  'русский': 'ru',
  'russe': 'ru',
  'russo': 'ru',
  'russisch': 'ru',
  
  // Japanese variants
  'japanese': 'ja',
  'japan': 'ja',
  '日本語': 'ja',
  'japonais': 'ja',
  'giapponese': 'ja',
  'japonês': 'ja',
  'japanisch': 'ja',
  
  // Chinese variants
  'chinese': 'zh',
  'china': 'zh',
  '中文': 'zh',
  '中国话': 'zh',
  'chinois': 'zh',
  'cinese': 'zh',
  'chinês': 'zh',
  'chinesisch': 'zh',
  'mandarin': 'zh',
  'cantonese': 'zh',
  
  // Korean variants
  'korean': 'ko',
  'korea': 'ko',
  '한국어': 'ko',
  'coréen': 'ko',
  'coreano': 'ko',
  'koreanisch': 'ko',
  
  // Arabic variants
  'arabic': 'ar',
  'العربية': 'ar',
  'arabe': 'ar',
  'arabo': 'ar',
  'árabe': 'ar',
  'arabisch': 'ar',
  
  // Dutch variants
  'dutch': 'nl',
  'nederlands': 'nl',
  'holland': 'nl',
  'hollandais': 'nl',
  'olandese': 'nl',
  'holandês': 'nl',
  'niederländisch': 'nl',
  
  // Polish variants
  'polish': 'pl',
  'polski': 'pl',
  'polonais': 'pl',
  'polacco': 'pl',
  'polonês': 'pl',
  'polnisch': 'pl',
  
  // Swedish variants
  'swedish': 'sv',
  'svenska': 'sv',
  'suédois': 'sv',
  'svedese': 'sv',
  'sueco': 'sv',
  'schwedisch': 'sv',
  
  // Norwegian variants
  'norwegian': 'no',
  'norsk': 'no',
  'norvégien': 'no',
  'norvegese': 'no',
  'norueguês': 'no',
  'norwegisch': 'no',
  
  // Danish variants
  'danish': 'da',
  'dansk': 'da',
  'danois': 'da',
  'danese': 'da',
  'dinamarquês': 'da',
  'dänisch': 'da',
  
  // Finnish variants
  'finnish': 'fi',
  'suomi': 'fi',
  'finnois': 'fi',
  'finlandese': 'fi',
  'finlandês': 'fi',
  'finnisch': 'fi',
  
  // Czech variants
  'czech': 'cs',
  'čeština': 'cs',
  'tchèque': 'cs',
  'ceco': 'cs',
  'tcheco': 'cs',
  'tschechisch': 'cs',
  
  // Hungarian variants
  'hungarian': 'hu',
  'magyar': 'hu',
  'hongrois': 'hu',
  'ungherese': 'hu',
  'húngaro': 'hu',
  'ungarisch': 'hu',
  
  // Romanian variants
  'romanian': 'ro',
  'română': 'ro',
  'roumain': 'ro',
  'rumeno': 'ro',
  'romeno': 'ro',
  'rumänisch': 'ro',
  
  // Bulgarian variants
  'bulgarian': 'bg',
  'български': 'bg',
  'bulgare': 'bg',
  'bulgaro': 'bg',
  'búlgaro': 'bg',
  'bulgarisch': 'bg',
  
  // Greek variants
  'greek': 'el',
  'ελληνικά': 'el',
  'grec': 'el',
  'greco': 'el',
  'grego': 'el',
  'griechisch': 'el',
  
  // Hebrew variants
  'hebrew': 'he',
  'עברית': 'he',
  'hébreu': 'he',
  'ebraico': 'he',
  'hebraico': 'he',
  'hebräisch': 'he',
  
  // Hindi variants
  'hindi': 'hi',
  'हिन्दी': 'hi',
  'हिंदी': 'hi',
  'indien': 'hi',
  'indiano': 'hi',
  
  // Thai variants
  'thai': 'th',
  'thailand': 'th',
  'tha': 'th',
  'ไทย': 'th',
  'thaï': 'th',
  'tailandês': 'th',
  
  // Vietnamese variants
  'vietnamese': 'vi',
  'tiếng việt': 'vi',
  'vietnamien': 'vi',
  'vietnamita': 'vi',
  'vietnamesisch': 'vi',
  
  // Turkish variants
  'turkish': 'tr',
  'türkçe': 'tr',
  'turc': 'tr',
  'turco': 'tr',
  'türkisch': 'tr',
  
  // Ukrainian variants
  'ukrainian': 'uk',
  'українська': 'uk',
  'ukrainien': 'uk',
  'ucraino': 'uk',
  'ucraniano': 'uk',
  'ukrainisch': 'uk',
  
  // Indonesian variants
  'indonesian': 'id',
  'bahasa indonesia': 'id',
  'indonésien': 'id',
  'indonesiano': 'id',
  'indonésio': 'id',
  'indonesisch': 'id',
  
  // Malay variants
  'malay': 'ms',
  'bahasa malaysia': 'ms',
  'malais': 'ms',
  'malese': 'ms',
  'malaio': 'ms',
  
  // Filipino variants
  'filipino': 'tl',
  'tagalog': 'tl',
  'philippin': 'tl',
  'filippino': 'tl',
  
  // Additional European languages
  'slovak': 'sk',
  'slovenčina': 'sk',
  'slovaque': 'sk',
  'slovacco': 'sk',
  'eslovaco': 'sk',
  'slowakisch': 'sk',
  
  'slovenian': 'sl',
  'slovenščina': 'sl',
  'slovène': 'sl',
  'sloveno': 'sl',
  'esloveno': 'sl',
  'slowenisch': 'sl',
  
  'croatian': 'hr',
  'hrvatski': 'hr',
  'croate': 'hr',
  'croato': 'hr',
  'croata': 'hr',
  'kroatisch': 'hr',
  
  'serbian': 'sr',
  'српски': 'sr',
  'serbe': 'sr',
  'serbo': 'sr',
  'sérvio': 'sr',
  'serbisch': 'sr',
  
  'bosnian': 'bs',
  'bosanski': 'bs',
  'bosniaque': 'bs',
  'bosniaco': 'bs',
  'bósnio': 'bs',
  'bosnisch': 'bs',
  
  'albanian': 'sq',
  'shqip': 'sq',
  'albanais': 'sq',
  'albanese': 'sq',
  'albanês': 'sq',
  'albanisch': 'sq',
  
  'macedonian': 'mk',
  'македонски': 'mk',
  'macédonien': 'mk',
  'macedone': 'mk',
  'macedônio': 'mk',
  'mazedonisch': 'mk',
  
  // Baltic languages
  'latvian': 'lv',
  'latviešu': 'lv',
  'letton': 'lv',
  'lettone': 'lv',
  'letão': 'lv',
  'lettisch': 'lv',
  
  'lithuanian': 'lt',
  'lietuvių': 'lt',
  'lituanien': 'lt',
  'lituano': 'lt',
  'lituano': 'lt',
  'litauisch': 'lt',
  
  'estonian': 'et',
  'eesti': 'et',
  'estonien': 'et',
  'estone': 'et',
  'estônio': 'et',
  'estnisch': 'et',
  
  // Nordic languages
  'icelandic': 'is',
  'íslenska': 'is',
  'islandais': 'is',
  'islandese': 'is',
  'islandês': 'is',
  'isländisch': 'is',
  
  // Celtic languages
  'welsh': 'cy',
  'cymraeg': 'cy',
  'gallois': 'cy',
  'gallese': 'cy',
  'galês': 'cy',
  'walisisch': 'cy',
  
  'irish': 'ga',
  'gaeilge': 'ga',
  'irlandais': 'ga',
  'irlandese': 'ga',
  'irlandês': 'ga',
  'irisch': 'ga',
  
  // Regional languages
  'catalan': 'ca',
  'català': 'ca',
  'catalán': 'ca',
  'catalão': 'ca',
  'katalanisch': 'ca',
  
  'basque': 'eu',
  'euskera': 'eu',
  'basque': 'eu',
  'basco': 'eu',
  'basco': 'eu',
  'baskisch': 'eu',
  
  'galician': 'gl',
  'galego': 'gl',
  'gallego': 'gl',
  'galego': 'gl',
  'galizisch': 'gl'
};

// Country flag to language mapping - Comprehensive list of 150+ flags
const flagToLanguage = {
  // English-speaking countries
  '🇺🇸': 'en', // United States
  '🇬🇧': 'en', // United Kingdom
  '🇨🇦': 'en', // Canada
  '🇦🇺': 'en', // Australia
  '🇳🇿': 'en', // New Zealand
  '🇮🇪': 'en', // Ireland
  '🇿🇦': 'en', // South Africa
  '🇯🇲': 'en', // Jamaica
  '🇹🇹': 'en', // Trinidad and Tobago
  '🇧🇸': 'en', // Bahamas
  '🇧🇧': 'en', // Barbados
  '🇬🇩': 'en', // Grenada
  '🇱🇨': 'en', // Saint Lucia
  '🇻🇨': 'en', // Saint Vincent and the Grenadines
  '🇦🇬': 'en', // Antigua and Barbuda
  '🇩🇲': 'en', // Dominica
  '🇰🇳': 'en', // Saint Kitts and Nevis
  '🇬🇾': 'en', // Guyana
  '🇧🇿': 'en', // Belize
  '🇲🇹': 'en', // Malta
  '🇸🇬': 'en', // Singapore
  '🇭🇰': 'en', // Hong Kong
  '🇵🇭': 'en', // Philippines (English is official)
  '🇮🇳': 'en', // India (English is official)
  '🇳🇬': 'en', // Nigeria
  '🇰🇪': 'en', // Kenya
  '🇺🇬': 'en', // Uganda
  '🇬🇭': 'en', // Ghana
  '🇹🇿': 'en', // Tanzania
  '🇿🇼': 'en', // Zimbabwe
  '🇧🇼': 'en', // Botswana
  '🇿🇲': 'en', // Zambia
  '🇲🇼': 'en', // Malawi
  '🇸🇿': 'en', // Eswatini
  '🇱🇸': 'en', // Lesotho
  '🇳🇦': 'en', // Namibia
  '🇱🇷': 'en', // Liberia
  '🇸🇱': 'en', // Sierra Leone
  '🇬🇲': 'en', // Gambia
  '🇫🇯': 'en', // Fiji
  '🇻🇺': 'en', // Vanuatu
  '🇸🇧': 'en', // Solomon Islands
  '🇵🇬': 'en', // Papua New Guinea
  '🇼🇸': 'en', // Samoa
  '🇹🇴': 'en', // Tonga
  '🇰🇮': 'en', // Kiribati
  '🇹🇻': 'en', // Tuvalu
  '🇳🇷': 'en', // Nauru
  '🇵🇼': 'en', // Palau
  '🇲🇭': 'en', // Marshall Islands
  '🇫🇲': 'en', // Micronesia

  // Spanish-speaking countries
  '🇪🇸': 'es', // Spain
  '🇪🇦': 'es', // Spain (regional flag)
  '🇲🇽': 'es', // Mexico
  '🇦🇷': 'es', // Argentina
  '🇨🇱': 'es', // Chile
  '🇨🇴': 'es', // Colombia
  '🇵🇪': 'es', // Peru
  '🇻🇪': 'es', // Venezuela
  '🇺🇾': 'es', // Uruguay
  '🇪🇨': 'es', // Ecuador
  '🇧🇴': 'es', // Bolivia
  '🇵🇾': 'es', // Paraguay
  '🇬🇹': 'es', // Guatemala
  '🇨🇷': 'es', // Costa Rica
  '🇵🇦': 'es', // Panama
  '🇳🇮': 'es', // Nicaragua
  '🇭🇳': 'es', // Honduras
  '🇸🇻': 'es', // El Salvador
  '🇩🇴': 'es', // Dominican Republic
  '🇨🇺': 'es', // Cuba
  '🇵🇷': 'es', // Puerto Rico
  '�🇶': 'es', // Equatorial Guinea

  // French-speaking countries
  '🇫🇷': 'fr', // France
  '🇧🇪': 'fr', // Belgium
  '🇨🇭': 'fr', // Switzerland
  '🇱🇺': 'fr', // Luxembourg
  '🇲🇨': 'fr', // Monaco
  '��': 'fr', // Senegal
  '🇲🇱': 'fr', // Mali
  '🇧🇫': 'fr', // Burkina Faso
  '🇳�🇪': 'fr', // Niger
  '🇹🇩': 'fr', // Chad
  '🇨🇫': 'fr', // Central African Republic
  '🇨🇲': 'fr', // Cameroon
  '🇬🇦': 'fr', // Gabon
  '🇨🇬': 'fr', // Republic of the Congo
  '🇨🇩': 'fr', // Democratic Republic of the Congo
  '🇧🇯': 'fr', // Benin
  '🇹🇬': 'fr', // Togo
  '🇨🇮': 'fr', // Côte d'Ivoire
  '🇬🇳': 'fr', // Guinea
  '🇲🇬': 'fr', // Madagascar
  '🇰🇲': 'fr', // Comoros
  '🇸🇨': 'fr', // Seychelles
  '🇩🇯': 'fr', // Djibouti
  '🇭🇹': 'fr', // Haiti
  '🇻🇺': 'fr', // Vanuatu (French is official)

  // German-speaking countries
  '🇩🇪': 'de', // Germany
  '🇦🇹': 'de', // Austria
  '🇱🇮': 'de', // Liechtenstein

  // Portuguese-speaking countries
  '🇵🇹': 'pt', // Portugal
  '🇧🇷': 'pt', // Brazil
  '🇦🇴': 'pt', // Angola
  '🇲🇿': 'pt', // Mozambique
  '🇬🇼': 'pt', // Guinea-Bissau
  '🇨🇻': 'pt', // Cape Verde
  '��': 'pt', // São Tomé and Príncipe
  '🇹🇱': 'pt', // Timor-Leste
  '🇲🇴': 'pt', // Macau

  // Italian-speaking countries
  '🇮🇹': 'it', // Italy
  '🇻🇦': 'it', // Vatican City
  '🇸🇲': 'it', // San Marino

  // Russian-speaking countries
  '🇷🇺': 'ru', // Russia
  '🇧🇾': 'ru', // Belarus
  '🇰🇿': 'ru', // Kazakhstan
  '🇰🇬': 'ru', // Kyrgyzstan
  '🇹🇯': 'ru', // Tajikistan

  // Arabic-speaking countries
  '🇸🇦': 'ar', // Saudi Arabia
  '🇦🇪': 'ar', // United Arab Emirates
  '🇪🇬': 'ar', // Egypt
  '🇮🇶': 'ar', // Iraq
  '🇯🇴': 'ar', // Jordan
  '🇱🇧': 'ar', // Lebanon
  '🇸🇾': 'ar', // Syria
  '🇾🇪': 'ar', // Yemen
  '🇴🇲': 'ar', // Oman
  '🇰🇼': 'ar', // Kuwait
  '🇶🇦': 'ar', // Qatar
  '🇧🇭': 'ar', // Bahrain
  '🇲🇦': 'ar', // Morocco
  '🇹🇳': 'ar', // Tunisia
  '🇩🇿': 'ar', // Algeria
  '🇱🇾': 'ar', // Libya
  '🇸🇩': 'ar', // Sudan
  '🇸🇸': 'ar', // South Sudan
  '🇪🇷': 'ar', // Eritrea
  '🇩🇯': 'ar', // Djibouti
  '🇰🇲': 'ar', // Comoros
  '🇲�': 'ar', // Mauritania
  '🇵🇸': 'ar', // Palestine

  // Dutch-speaking countries
  '🇳🇱': 'nl', // Netherlands
  '🇸🇷': 'nl', // Suriname

  // Individual language countries
  '🇯🇵': 'ja', // Japanese
  '🇨🇳': 'zh', // Chinese (Mandarin)
  '🇹🇼': 'zh', // Chinese (Traditional)
  '🇰🇷': 'ko', // Korean
  '��': 'th', // Thai
  '��': 'vi', // Vietnamese
  '🇮🇩': 'id', // Indonesian
  '��': 'ms', // Malay
  '🇹🇷': 'tr', // Turkish
  '🇺🇦': 'uk', // Ukrainian
  '🇵🇱': 'pl', // Polish
  '🇸🇪': 'sv', // Swedish
  '🇳🇴': 'no', // Norwegian
  '🇩🇰': 'da', // Danish
  '🇫🇮': 'fi', // Finnish
  '��': 'is', // Icelandic
  '🇭🇺': 'hu', // Hungarian
  '🇨🇿': 'cs', // Czech
  '🇸🇰': 'sk', // Slovak
  '🇸🇮': 'sl', // Slovenian
  '🇭🇷': 'hr', // Croatian
  '🇷🇸': 'sr', // Serbian
  '🇧🇦': 'bs', // Bosnian
  '🇲�': 'mk', // Macedonian
  '🇦🇱': 'sq', // Albanian
  '🇲🇪': 'sr', // Montenegro (Serbian)
  '🇽🇰': 'sq', // Kosovo (Albanian)
  '🇧🇬': 'bg', // Bulgarian
  '🇷🇴': 'ro', // Romanian
  '🇲🇩': 'ro', // Moldova (Romanian)
  '🇱🇹': 'lt', // Lithuanian
  '🇱�': 'lv', // Latvian
  '🇪🇪': 'et', // Estonian
  '🇬🇷': 'el', // Greek
  '🇨🇾': 'el', // Cyprus (Greek)
  '🇮🇱': 'he', // Hebrew
  '��': 'hy', // Armenian
  '🇬🇪': 'ka', // Georgian
  '��': 'az', // Azerbaijani
  '��': 'uz', // Uzbek
  '🇹🇲': 'tk', // Turkmen
  '��': 'mn', // Mongolian
  '🇰🇭': 'km', // Khmer (Cambodian)
  '�🇦': 'lo', // Lao
  '�🇲�': 'my', // Myanmar (Burmese)
  '��': 'ne', // Nepali
  '🇱🇰': 'si', // Sinhala (Sri Lanka)
  '��': 'bn', // Bengali (Bangladesh)
  '��': 'ur', // Urdu (Pakistan)
  '��': 'fa', // Persian/Dari (Afghanistan)
  '��': 'fa', // Persian (Iran)
  '�🇹': 'am', // Amharic (Ethiopia)
  '��': 'sw', // Swahili (Kenya)
  '��': 'sw', // Swahili (Tanzania)
  '��': 'sw', // Swahili (Uganda)
  '🇷🇼': 'rw', // Kinyarwanda
  '��': 'rn', // Kirundi
  '🇲🇬': 'mg', // Malagasy

  // Additional European languages
  '��': 'ca', // Catalan (using Spain flag as alternative)
  '��': 'ca', // Andorra (Catalan)
  '��': 'eu', // Basque (using Spain flag as alternative)
  '🇸': 'gl', // Galician (using Spain flag as alternative)
  '�🇪': 'ga', // Irish Gaelic
  '🇬🇧': 'cy', // Welsh (using UK flag)
  '��': 'gd', // Scottish Gaelic (using UK flag)

  // Asian languages with specific regions
  '��': 'hi', // Hindi (India)
  '��': 'bn', // Bengali (India)
  '��': 'te', // Telugu
  '🇮🇳': 'mr', // Marathi
  '🇮🇳': 'ta', // Tamil
  '🇮🇳': 'gu', // Gujarati
  '��': 'kn', // Kannada
  '🇮🇳': 'ml', // Malayalam
  '��': 'or', // Odia
  '🇮🇳': 'pa', // Punjabi

  // Pacific Islands with English
  '🇬🇺': 'en', // Guam
  '🇦🇸': 'en', // American Samoa
  '🇲🇵': 'en', // Northern Mariana Islands
  '�🇮': 'en', // US Virgin Islands
  '🇵🇷': 'en', // Puerto Rico (bilingual)

  // Caribbean with various languages
  '🇦🇼': 'nl', // Aruba (Dutch)
  '🇨🇼': 'nl', // Curaçao (Dutch)
  '🇸🇽': 'nl', // Sint Maarten (Dutch)
  '🇲🇫': 'fr', // Saint Martin (French)
  '🇬🇵': 'fr', // Guadeloupe (French)
  '🇲🇶': 'fr', // Martinique (French)
  '🇬🇫': 'fr', // French Guiana (French)

  // Additional African languages
  '🇿🇦': 'af', // Afrikaans (South Africa)
  '🇿🇦': 'zu', // Zulu
  '��': 'xh', // Xhosa
  '🇳🇬': 'ha', // Hausa (Nigeria)
  '🇳🇬': 'yo', // Yoruba (Nigeria)
  '🇳🇬': 'ig', // Igbo (Nigeria)
  
  // Regional and subdivision flags - common variants users might encounter
  '🏴󠁧󠁢󠁥󠁮󠁧󠁿': 'en', // England
  '🏴󠁧󠁢󠁳󠁣󠁴󠁿': 'en', // Scotland  
  '🏴󠁧󠁢󠁷󠁬󠁳󠁿': 'en', // Wales
  '🇺🇳': 'en', // United Nations (default to English)
};

// Language to flag mapping (for responses) - Comprehensive list
const languageToFlag = {
  'en': '🇺🇸', // English
  'es': '🇪🇸', // Spanish
  'fr': '🇫🇷', // French
  'de': '🇩🇪', // German
  'it': '🇮🇹', // Italian
  'pt': '🇵🇹', // Portuguese
  'ru': '🇷🇺', // Russian
  'ja': '🇯🇵', // Japanese
  'zh': '🇨🇳', // Chinese
  'ko': '🇰🇷', // Korean
  'ar': '🇸🇦', // Arabic
  'nl': '🇳🇱', // Dutch
  'pl': '🇵🇱', // Polish
  'sv': '🇸🇪', // Swedish
  'no': '🇳🇴', // Norwegian
  'da': '🇩🇰', // Danish
  'fi': '🇫🇮', // Finnish
  'cs': '🇨🇿', // Czech
  'hu': '🇭🇺', // Hungarian
  'ro': '🇷🇴', // Romanian
  'bg': '🇧🇬', // Bulgarian
  'el': '🇬🇷', // Greek
  'he': '🇮🇱', // Hebrew
  'hi': '🇮🇳', // Hindi
  'th': '🇹🇭', // Thai
  'vi': '🇻🇳', // Vietnamese
  'id': '🇮🇩', // Indonesian
  'ms': '🇲🇾', // Malay
  'tl': '🇵🇭', // Filipino
  'tr': '🇹🇷', // Turkish
  'uk': '🇺🇦', // Ukrainian
  'sk': '🇸🇰', // Slovak
  'sl': '🇸🇮', // Slovenian
  'hr': '🇭🇷', // Croatian
  'sr': '🇷🇸', // Serbian
  'bs': '🇧🇦', // Bosnian
  'mk': '🇲🇰', // Macedonian
  'sq': '🇦🇱', // Albanian
  'lv': '🇱🇻', // Latvian
  'lt': '🇱🇹', // Lithuanian
  'et': '🇪🇪', // Estonian
  'is': '🇮🇸', // Icelandic
  'mt': '🇲🇹', // Maltese
  'cy': '🇬🇧', // Welsh
  'ga': '🇮🇪', // Irish
  'gd': '🇬🇧', // Scottish Gaelic
  'ca': '🇦🇩', // Catalan
  'eu': '🇪🇸', // Basque
  'gl': '🇪🇸', // Galician
  'hy': '🇦🇲', // Armenian
  'ka': '🇬🇪', // Georgian
  'az': '🇦🇿', // Azerbaijani
  'uz': '🇺🇿', // Uzbek
  'tk': '🇹🇲', // Turkmen
  'mn': '🇲🇳', // Mongolian
  'km': '🇰🇭', // Khmer
  'lo': '🇱🇦', // Lao
  'my': '🇲🇲', // Myanmar
  'ne': '🇳🇵', // Nepali
  'si': '🇱🇰', // Sinhala
  'bn': '🇧🇩', // Bengali
  'ur': '🇵🇰', // Urdu
  'fa': '🇮🇷', // Persian
  'ps': '🇦🇫', // Pashto
  'am': '🇪🇹', // Amharic
  'sw': '🇰🇪', // Swahili
  'zu': '🇿🇦', // Zulu
  'af': '🇿🇦', // Afrikaans
  'xh': '🇿🇦', // Xhosa
  'ha': '🇳🇬', // Hausa
  'yo': '🇳🇬', // Yoruba
  'ig': '🇳🇬', // Igbo
  'rw': '🇷🇼', // Kinyarwanda
  'rn': '🇧🇮', // Kirundi
  'mg': '🇲🇬', // Malagasy
  'te': '🇮🇳', // Telugu
  'mr': '🇮🇳', // Marathi
  'ta': '🇮🇳', // Tamil
  'gu': '🇮🇳', // Gujarati
  'kn': '🇮🇳', // Kannada
  'ml': '🇮🇳', // Malayalam
  'or': '🇮🇳', // Odia
  'pa': '🇮🇳', // Punjabi
  'as': '🇮🇳', // Assamese
  'be': '🇧🇾', // Belarusian
  'kk': '🇰🇿', // Kazakh
  'ky': '🇰🇬', // Kyrgyz
  'tg': '🇹🇯', // Tajik
  'lb': '🇱🇺', // Luxembourgish
  'fo': '🇫🇴', // Faroese
  'kl': '🇬🇱'  // Greenlandic
};

// Function to send private translation reply
async function sendFlagTranslation(message, targetUser, flag, originalText, translatedText, fromLang, toLang) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(`${flag} Translation`)
      .setDescription(`**Original (${fromLang.toUpperCase()}):**\n${originalText.length > 500 ? originalText.substring(0, 500) + '...' : originalText}`)
      .addFields([
        { 
          name: `**Translated (${toLang.toUpperCase()}):**`, 
          value: translatedText.length > 1000 ? translatedText.substring(0, 1000) + '...' : translatedText 
        }
      ])
      .setColor(0x4A90E2)
      .setFooter({ 
        text: `Translation • This message will auto-delete in 45 seconds ⏰`, 
        iconURL: message.author.displayAvatarURL({ dynamic: true }) 
      })
      .setTimestamp();

    // Send as reply to the original message, mentioning the user who requested it
    const replyMessage = await message.reply({
      content: `${targetUser}, here's your ${flag} translation:`,
      embeds: [embed],
      allowedMentions: { users: [targetUser.id] }
    });

    // Auto-delete after 45 seconds with countdown updates
    let timeLeft = 45;
    
    // Update countdown every 10 seconds for the last 30 seconds
    const countdownInterval = setInterval(async () => {
      timeLeft -= 10;
      if (timeLeft <= 30 && timeLeft > 0) {
        try {
          const updatedEmbed = EmbedBuilder.from(embed)
            .setFooter({ 
              text: `Translation • Auto-deleting in ${timeLeft} seconds ⏰`, 
              iconURL: message.author.displayAvatarURL({ dynamic: true }) 
            });
          
          await replyMessage.edit({ embeds: [updatedEmbed] });
          console.log(`[TRANSLATION] Updated countdown: ${timeLeft} seconds remaining`);
        } catch (error) {
          console.error(`[TRANSLATION] Failed to update countdown:`, error.message);
          clearInterval(countdownInterval);
        }
      }
    }, 10000);

    // Auto-delete after 45 seconds
    setTimeout(async () => {
      clearInterval(countdownInterval);
      try {
        console.log(`[TRANSLATION] Attempting to auto-delete translation message after 45 seconds`);
        await replyMessage.delete();
        console.log(`[TRANSLATION] Successfully auto-deleted translation message`);
      } catch (error) {
        console.error(`[TRANSLATION] Failed to auto-delete translation message:`, error.message);
        // Try to edit message to indicate deletion failed
        try {
          const failedEmbed = EmbedBuilder.from(embed)
            .setFooter({ 
              text: `Translation • Failed to auto-delete (please delete manually) ❌`, 
              iconURL: message.author.displayAvatarURL({ dynamic: true }) 
            })
            .setColor(0xFF6B6B);
          await replyMessage.edit({ embeds: [failedEmbed] });
        } catch (editError) {
          console.error(`[TRANSLATION] Failed to update message after deletion failure:`, editError.message);
        }
      }
    }, 45000);

    logTranslation(`Sent ${flag} translation for user ${targetUser.username} (${fromLang} → ${toLang})`);
    
  } catch (error) {
    console.error('Error sending flag translation:', error);
  }
}

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
    let detectedLang = res.from.language.iso;
    
    // Normalize detected language to match our language mapping system
    detectedLang = languageMap[detectedLang] || detectedLang;
    
    translationCache.set(cacheKey, detectedLang);
    logTranslation(`Language detected: ${res.from.language.iso} → normalized to: ${detectedLang}`);
    return detectedLang;
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
    
    // Use the main languageMap for consistency
    const targetCode = languageMap[cleanTarget] || cleanTarget;
    
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
    name: 'オンボーディング',
    description: '認証プロセスを開始する (Start verification process in Japanese)'
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
      description: 'Language code (en, es, fr, de, it, pt, ru, ja, zh, ko, ar, etc.) or full name',
      required: true
    }]
  },
  {
    name: 'getlang',
    description: 'View your current language settings'
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
        { name: 'Force verify', value: 'force_verify' },
        { name: 'Start onboarding profile', value: 'start_onboarding' },
        { name: 'Reset verification', value: 'reset_verification' }
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
    }, {
      name: 'dev_channel',
      type: 7, // CHANNEL
      description: 'Channel for development reports and onboarding alerts'
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
    name: 'flags',
    description: 'See all supported country flags for translation'
  },
  {
    name: 'help',
    description: 'Get help with bot commands and features'
  },
  {
    name: 'get-translation',
    description: 'Get your private translation (only you can see it)'
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
  logVerification(`Bot started: ${client.user.tag} is online`);
  logTranslation(`Translation system initialized`);
  
  // Log intent information for debugging
  console.log('🔍 Bot intents debugging:');
  console.log(`   Intents bitfield: ${client.options.intents.bitfield}`);
  console.log(`   Has GuildMessageReactions: ${client.options.intents.has('GuildMessageReactions')}`);
  console.log(`   Has MessageContent: ${client.options.intents.has('MessageContent')}`);
  console.log(`   All intents: ${client.options.intents.toArray().join(', ')}`);
  
  // Log directory info
  console.log(`📂 Logs will be saved to: ${logsDir}`);
  console.log(`📄 Translation logs: translation-YYYY-MM-DD.log`);
  console.log(`📄 Verification logs: verification-YYYY-MM-DD.log`);
  
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

  // Schedule 12-hour onboarding reports (at 6 AM and 6 PM every day)
  cron.schedule('0 6,18 * * *', async () => {
    console.log('📋 Running 12-hour onboarding report...');
    await runOnboardingReport();
  });
});

// Function to run onboarding report
async function runOnboardingReport() {
  try {
    // Get all guilds the bot is in
    const guilds = client.guilds.cache;
    
    for (const [guildId, guild] of guilds) {
      try {
        // Get guild settings to find dev channel
        const guildSettings = await new Promise((resolve, reject) => {
          db.get(
            'SELECT devChannelId FROM guild_settings WHERE guildId = ?',
            [guildId],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        });

        // Skip if no dev channel is configured
        if (!guildSettings || !guildSettings.devChannelId) {
          console.log(`⚠️ No dev channel configured for guild: ${guild.name}`);
          continue;
        }

        // Find the dev channel
        const devChannel = guild.channels.cache.get(guildSettings.devChannelId);
        if (!devChannel) {
          console.log(`⚠️ Dev channel not found for guild: ${guild.name}`);
          continue;
        }

        // Find the not-onboarded role
        const notOnboardedRole = guild.roles.cache.find(role => role.name === 'not-onboarded');
        if (!notOnboardedRole) {
          console.log(`⚠️ No 'not-onboarded' role found in guild: ${guild.name}`);
          continue;
        }

        // Get all members with the not-onboarded role
        const notOnboardedMembers = guild.members.cache.filter(member => 
          member.roles.cache.has(notOnboardedRole.id) && !member.user.bot
        );

        if (notOnboardedMembers.size === 0) {
          // Send success message if everyone is onboarded
          const successEmbed = new EmbedBuilder()
            .setTitle('🎉 Onboarding Report - All Clear!')
            .setDescription('Great news! All members have completed the onboarding process.')
            .setColor('#00FF00')
            .setTimestamp()
            .addFields([
              { name: '✅ Onboarded Members', value: `${guild.memberCount - 1}`, inline: true }, // -1 for bot
              { name: '⏰ Report Time', value: `Every 12 hours (6 AM & 6 PM)`, inline: true }
            ])
            .setFooter({ text: `${guild.name} • Region40Bot` });

          await devChannel.send({ embeds: [successEmbed] });
          console.log(`✅ All members onboarded in guild: ${guild.name}`);
          continue;
        }

        // Create embed with not-onboarded members
        const embed = new EmbedBuilder()
          .setTitle('📋 Onboarding Report - Pending Members')
          .setDescription(`The following members still need to complete onboarding:`)
          .setColor('#FF6B6B')
          .setTimestamp()
          .setFooter({ text: `${guild.name} • Region40Bot` });

        // Group members by join date for better organization
        const membersByDate = new Map();
        
        notOnboardedMembers.forEach(member => {
          const joinDate = member.joinedAt.toDateString();
          if (!membersByDate.has(joinDate)) {
            membersByDate.set(joinDate, []);
          }
          membersByDate.get(joinDate).push(member);
        });

        // Sort dates (newest first)
        const sortedDates = Array.from(membersByDate.keys()).sort((a, b) => 
          new Date(b) - new Date(a)
        );

        let description = '';
        let totalCount = 0;

        // Add members grouped by join date
        for (const date of sortedDates.slice(0, 10)) { // Limit to last 10 days to prevent message being too long
          const members = membersByDate.get(date);
          const daysSinceJoin = Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
          
          description += `\n**${date}** (${daysSinceJoin} days ago):\n`;
          
          for (const member of members.slice(0, 10)) { // Limit to 10 members per day
            const timeAgo = Math.floor((Date.now() - member.joinedAt) / (1000 * 60 * 60));
            description += `• ${member.user.username} (${member.user.tag}) - ${timeAgo}h ago\n`;
            totalCount++;
          }
          
          if (members.length > 10) {
            description += `• ... and ${members.length - 10} more\n`;
            totalCount += members.length - 10;
          }
        }

        if (sortedDates.length > 10) {
          const remainingDays = sortedDates.length - 10;
          const remainingMembers = sortedDates.slice(10).reduce((sum, date) => 
            sum + membersByDate.get(date).length, 0
          );
          description += `\n*... and ${remainingMembers} more members from ${remainingDays} earlier days*`;
          totalCount += remainingMembers;
        }

        embed.setDescription(description);
        embed.addFields([
          { name: '👥 Total Pending', value: `${totalCount} members`, inline: true },
          { name: '✅ Onboarded', value: `${guild.memberCount - totalCount - 1} members`, inline: true }, // -1 for bot
          { name: '⏰ Next Report', value: 'In 12 hours', inline: true }
        ]);

        // Add action buttons for admins
        const actionRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('remind_onboarding')
              .setLabel('Send Reminders')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('📨'),
            new ButtonBuilder()
              .setCustomId('view_oldest')
              .setLabel('View Oldest')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('⏰')
          );

        await devChannel.send({ 
          embeds: [embed],
          components: [actionRow]
        });

        console.log(`📋 Sent onboarding report for guild: ${guild.name} (${totalCount} pending members)`);

      } catch (guildError) {
        console.error(`Error processing onboarding report for guild ${guild.name}:`, guildError);
      }
    }
  } catch (error) {
    console.error('Error running onboarding report:', error);
  }
}

// Function to send ephemeral translation messages
async function sendEphemeralTranslation(channel, userId, originalAuthor, originalText, translatedText, fromLang, toLang) {
  try {
    // Double-check that translation is actually needed
    if (fromLang === toLang) {
      logTranslation(`Skipping translation for user ${userId} - same language (${fromLang} === ${toLang})`);
      return;
    }
    
    // Also check if the translated text is different enough to warrant showing
    if (translatedText.toLowerCase().trim() === originalText.toLowerCase().trim()) {
      logTranslation(`Skipping translation for user ${userId} - identical text after translation`);
      return;
    }
    
    // Store the translation for the user to retrieve via slash command
    if (!client.userTranslations) {
      client.userTranslations = new Map();
    }
    
    const translationKey = `${userId}_${channel.id}`;
    const translationData = {
      originalAuthor: originalAuthor.username,
      originalText,
      translatedText,
      fromLang,
      toLang,
      timestamp: Date.now(),
      channelName: channel.name,
      authorAvatar: originalAuthor.displayAvatarURL()
    };
    
    // Store the translation (overwrite any existing one for this user in this channel)
    client.userTranslations.set(translationKey, translationData);
    
    // Send a very subtle notification that doesn't @ the user
    const notificationEmbed = new EmbedBuilder()
      .setDescription(`💬 **New translation available** - Use \`/get-translation\` to view privately`)
      .setColor(0x00AE86)
      .setTimestamp()
      .setFooter({ text: `For: ${channel.guild.members.cache.get(userId)?.displayName || 'Unknown User'}` });

    const tempMessage = await channel.send({ 
      embeds: [notificationEmbed],
      allowedMentions: { users: [] } // No mentions at all
    });
    
    // Delete the notification after 10 seconds
    setTimeout(async () => {
      try {
        await tempMessage.delete();
      } catch (error) {
        // Message might already be deleted
      }
    }, 10000); // 10 seconds
    
    // Clean up old translations after 5 minutes
    setTimeout(() => {
      client.userTranslations.delete(translationKey);
    }, 300000); // 5 minutes
    
    logTranslation(`Translation stored for user ${userId} in ${channel.name} (${fromLang} → ${toLang})`);

  } catch (error) {
    console.error('Error sending ephemeral translation:', error);
  }
}

// Function to check if user is online/active
function isUserOnline(guild, userId) {
  try {
    const member = guild.members.cache.get(userId);
    if (!member) return false;
    
    const presence = member.presence;
    if (!presence) return false;
    
    // Consider user online if they're online, idle, or dnd (not offline/invisible)
    return ['online', 'idle', 'dnd'].includes(presence.status);
  } catch (error) {
    return false;
  }
}

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
        .setTitle('🎉 Welcome to the server! | サーバーへようこそ！')
        .setDescription(`Hello ${member.user.username}! Welcome to **${member.guild.name}**!\n\nTo get started, simply reply with: **verify**\n\n*こんにちは ${member.user.username}さん！**${member.guild.name}**へようこそ！*\n\n*開始するには、次のように返信してください：**verify** または **認証***`)
        .addFields([
          { name: '🔐 Step 1 | ステップ1', value: 'Reply with "verify" to this message\n*このメッセージに「verify」または「認証」で返信*' },
          { name: '👤 Step 2 | ステップ2', value: 'Complete your profile setup\n*プロフィール設定を完了*' },
          { name: '🛡️ Step 3 | ステップ3', value: 'Choose your alliance\n*アライアンスを選択*' },
          { name: '🌐 Optional | オプション', value: 'Set up auto-translation\n*自動翻訳を設定*' }
        ])
        .setColor(0x00AE86)
        .setThumbnail(member.guild.iconURL());
      
      await member.send({ embeds: [dmEmbed] });
      logVerification(`Sent welcome DM to ${member.user.username}`);
    } catch (dmError) {
      logVerification(`Could not send DM to ${member.user.username}: ${dmError.message}`);
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
      
      // Handle "verify" command for verification and onboarding start (English and Japanese)
      const messageContent = message.content.trim().toLowerCase();
      if (messageContent === 'verify' || messageContent === '認証' || messageContent === 'にんしょう') {
        if (!userProfile) {
          // Create new profile and start verification
          logVerification(`Creating new profile for ${message.author.username}`);
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
                  logVerification(`Removed "not-onboarded" role from ${member.user.username} in ${guild.name}`);
                }
              }
            } catch (error) {
              logVerification(`Error removing role in guild ${guild.name}: ${error.message}`);
            }
          }
          
          await startAutomatedOnboarding(message.author);
        } else if (!userProfile.verified) {
          // User exists but not verified - verify them
          logVerification(`Verifying existing user ${message.author.username}`);
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
                  logVerification(`Removed "not-onboarded" role from ${member.user.username} in ${guild.name}`);
                }
              }
            } catch (error) {
              logVerification(`Error removing role in guild ${guild.name}: ${error.message}`);
            }
          }
          
          await startAutomatedOnboarding(message.author);
        } else if (!userProfile.onboardingStep || userProfile.onboardingStep === 'pending') {
          // User is verified but hasn't started onboarding yet
          await startAutomatedOnboarding(message.author);
        } else {
          // User is already in onboarding process - help them continue
          const currentStep = userProfile.onboardingStep;
          
          if (currentStep === 'profile') {
            // Remind them about profile completion
            const profileEmbed = new EmbedBuilder()
              .setTitle('📝 Continue Profile Setup')
              .setDescription('You\'re already in the onboarding process! Let\'s complete your profile setup.')
              .addFields([
                { name: '🎮 In-Game Name', value: 'What is your in-game name?' },
                { name: '🌍 Timezone/Country', value: 'What timezone/country are you in? (e.g., EST, PST, UK, Germany)' },
                { name: '🌐 Language', value: 'What is your preferred language?\n\n**Available codes:**\n`en` (English), `es` (Spanish), `fr` (French), `de` (German), `it` (Italian), `pt` (Portuguese), `ru` (Russian), `ja` (Japanese), `zh` (Chinese), `ko` (Korean), `ar` (Arabic), `nl` (Dutch), `pl` (Polish), `sv` (Swedish), `no` (Norwegian), `da` (Danish), `fi` (Finnish), `cs` (Czech), `hu` (Hungarian), `ro` (Romanian), `bg` (Bulgarian), `el` (Greek), `he` (Hebrew), `hi` (Hindi), `th` (Thai), `vi` (Vietnamese)\n\nYou can use either the code (e.g., `en`) or full name (e.g., `English`).' }
              ])
              .setColor(0x00FF00)
              .setFooter({ text: '⏰ Please reply with: IGN | Timezone | Language (separated by | symbol)' });
            
            await message.author.send({ embeds: [profileEmbed] });
            
          } else if (currentStep === 'alliance') {
            // Remind them about alliance selection
            const allianceEmbed = new EmbedBuilder()
              .setTitle('🛡️ Continue Alliance Selection')
              .setDescription('You\'re almost done! Please choose your alliance from the list below:')
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
            
            await message.author.send({ embeds: [allianceEmbed, allianceOptions] });
            
          } else if (currentStep === 'complete') {
            // They're already done
            const completedEmbed = new EmbedBuilder()
              .setTitle('✅ Already Completed')
              .setDescription('Your onboarding is already complete! You have full access to all server features.')
              .setColor(0x00FF00);
            
            await message.author.send({ embeds: [completedEmbed] });
          }
        }
      } else if (userProfile && userProfile.verified && userProfile.onboardingStep && userProfile.onboardingStep !== 'complete') {
        await handleOnboardingResponse(message.author, message.content.trim());
      }
    } catch (error) {
      console.error('Error handling DM verification:', error);
    }
    return;
  }
  
  // Flag-based translation system for guild messages
  if (!message.guild || !message.content.trim()) return;
  
  try {
    // Check if message contains any country flag emojis
    const flagsInMessage = [];
    for (const [flag, langCode] of Object.entries(flagToLanguage)) {
      if (message.content.includes(flag)) {
        flagsInMessage.push({ flag, langCode });
      }
    }
    
    if (flagsInMessage.length === 0) return;
    
    // Check if this is a reply to another message
    const referencedMessage = message.reference ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null) : null;
    
    if (!referencedMessage || !referencedMessage.content.trim()) {
      // If no referenced message, inform user how to use the system
      const helpEmbed = new EmbedBuilder()
        .setTitle('🌍 Translation Request')
        .setDescription('To request a translation, you have **two options**:\n\n🎯 **Reply** to a message with a country flag emoji\n🎯 **React** to a message with a country flag emoji\n\n**Example:** Reply to a message with 🇪🇸 or react with 🇪🇸 to get it translated to Spanish')
        .addFields([
          { 
            name: '🚀 How to use:', 
            value: '1. Find a message you want translated\n2. **Reply** to it with a flag emoji (🇺🇸 🇪🇸 🇫🇷 🇩🇪 etc.) OR\n3. **React** to it with a flag emoji\n4. Get your private translation that auto-deletes in 45 seconds!'
          },
          {
            name: '🏁 Popular flags:',
            value: '🇺🇸 English • 🇪🇸 Spanish • 🇫🇷 French • 🇩🇪 German\n🇮🇹 Italian • 🇵🇹 Portuguese • 🇷🇺 Russian • 🇯🇵 Japanese\n🇨🇳 Chinese • 🇰🇷 Korean • 🇸🇦 Arabic • 🇹🇭 Thai'
          }
        ])
        .setColor(0x3498DB);
      
      const helpMessage = await message.reply({ embeds: [helpEmbed] });
      
      // Auto-delete help message after 30 seconds
      setTimeout(async () => {
        try {
          await helpMessage.delete();
          await message.delete();
        } catch (error) {
          // Messages might already be deleted
        }
      }, 30000);
      
      return;
    }
    
    // Process each flag found in the reply
    for (const { flag, langCode } of flagsInMessage) {
      try {
        // Detect original language
        const detectedLang = await detectLanguage(referencedMessage.content);
        
        // Skip if same language
        if (detectedLang === langCode) {
          logTranslation(`Skipping ${flag} translation - same language (${detectedLang} === ${langCode})`);
          continue;
        }
        
        // Translate the referenced message
        const translatedText = await translate(referencedMessage.content, langCode);
        
        if (translatedText && translatedText.toLowerCase() !== referencedMessage.content.toLowerCase()) {
          await sendFlagTranslation(
            referencedMessage, 
            message.author, 
            flag, 
            referencedMessage.content, 
            translatedText, 
            detectedLang, 
            langCode
          );
          
          // Delete the flag request message
          try {
            await message.delete();
          } catch (error) {
            // Message might already be deleted
          }
        }
        
      } catch (error) {
        logTranslation(`Error processing ${flag} translation: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('Error in flag-based translation:', error);
  }
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  try {
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
  } catch (error) {
    console.error('Error handling interaction:', error);
    
    // Try to respond with an error message if interaction hasn't been handled
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ 
          content: 'An error occurred while processing your request. Please try again.', 
          flags: MessageFlags.Ephemeral 
        });
      } catch (replyError) {
        console.error('Failed to send error reply (interaction may have expired):', replyError.message);
      }
    }
  }
});

// Message reaction handler for flag translations
client.on('messageReactionAdd', async (reaction, user) => {
  // Debug logging
  console.log(`[REACTION] Reaction added: ${reaction.emoji.name} by ${user.username}`);
  
  // Ignore bot reactions
  if (user.bot) {
    console.log(`[REACTION] Ignoring bot reaction from ${user.username}`);
    return;
  }
  
  try {
    // Fetch the reaction if it's partial
    if (reaction.partial) {
      try {
        await reaction.fetch();
        console.log(`[REACTION] Fetched partial reaction`);
      } catch (error) {
        console.error('Error fetching reaction:', error);
        return;
      }
    }
    
    // Fetch the message if it's partial
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
        console.log(`[REACTION] Fetched partial message`);
      } catch (error) {
        console.error('Error fetching message:', error);
        return;
      }
    }
    
    const message = reaction.message;
    const emoji = reaction.emoji.name;
    
    console.log(`[REACTION] Processing emoji: ${emoji}`);
    console.log(`[REACTION] Message content: ${message.content?.substring(0, 50)}...`);
    
    // Check if the emoji is a supported flag
    if (!flagToLanguage[emoji]) {
      console.log(`[REACTION] Unsupported flag emoji: ${emoji}`);
      return; // Not a supported flag emoji
    }
    
    console.log(`[REACTION] Found supported flag: ${emoji} -> ${flagToLanguage[emoji]}`);
    
    // Don't translate the user's own messages
    if (message.author.id === user.id) {
      console.log(`[REACTION] User trying to translate own message`);
      // Remove the reaction and send a helpful message
      try {
        await reaction.users.remove(user.id);
        const helpMessage = await message.reply(`${user}, you can't translate your own messages! 😊`);
        setTimeout(async () => {
          try {
            await helpMessage.delete();
          } catch (error) {
            // Message might already be deleted
          }
        }, 5000);
      } catch (error) {
        console.error('Error removing reaction or sending help:', error);
      }
      return;
    }
    
    // Don't translate empty messages
    if (!message.content || !message.content.trim()) {
      console.log(`[REACTION] Empty message content`);
      try {
        await reaction.users.remove(user.id);
        const helpMessage = await message.reply(`${user}, this message has no text to translate! 📝`);
        setTimeout(async () => {
          try {
            await helpMessage.delete();
          } catch (error) {
            // Message might already be deleted
          }
        }, 5000);
      } catch (error) {
        console.error('Error handling empty message:', error);
      }
      return;
    }
    
    const targetLang = flagToLanguage[emoji];
    console.log(`[REACTION] Target language: ${targetLang}`);
    
    // Detect the original language
    const detectedLang = await detectLanguage(message.content);
    console.log(`[REACTION] Detected language: ${detectedLang}`);
    
    // Skip if same language
    if (detectedLang === targetLang) {
      console.log(`[REACTION] Same language detected, skipping`);
      try {
        await reaction.users.remove(user.id);
        const helpMessage = await message.reply(`${user}, this message is already in ${emoji} ${targetLang.toUpperCase()}! 🌍`);
        setTimeout(async () => {
          try {
            await helpMessage.delete();
          } catch (error) {
            // Message might already be deleted
          }
        }, 5000);
      } catch (error) {
        console.error('Error handling same language:', error);
      }
      logTranslation(`Skipping ${emoji} reaction translation - same language (${detectedLang} === ${targetLang})`);
      return;
    }
    
    console.log(`[REACTION] Starting translation from ${detectedLang} to ${targetLang}`);
    
    // Translate the message
    const translatedText = await translate(message.content, targetLang);
    console.log(`[REACTION] Translation result: ${translatedText?.substring(0, 50)}...`);
    
    if (translatedText && translatedText.toLowerCase() !== message.content.toLowerCase()) {
      // Remove the reaction first
      try {
        await reaction.users.remove(user.id);
        console.log(`[REACTION] Removed reaction from user`);
      } catch (error) {
        console.error('Error removing reaction:', error);
      }
      
      // Send the translation
      await sendFlagTranslation(
        message, 
        user, 
        emoji, 
        message.content, 
        translatedText, 
        detectedLang, 
        targetLang
      );
      
      console.log(`[REACTION] Successfully sent translation`);
      logTranslation(`Processed ${emoji} reaction translation for user ${user.username} (${detectedLang} → ${targetLang})`);
    } else {
      console.log(`[REACTION] Translation failed or was identical`);
      // Remove reaction if translation failed or was identical
      try {
        await reaction.users.remove(user.id);
        const helpMessage = await message.reply(`${user}, couldn't translate this message to ${emoji}. Try a different language! 🤔`);
        setTimeout(async () => {
          try {
            await helpMessage.delete();
          } catch (error) {
            // Message might already be deleted
          }
        }, 5000);
      } catch (error) {
        console.error('Error handling failed translation:', error);
      }
    }
    
  } catch (error) {
    console.error('Error handling message reaction:', error);
    logTranslation(`Error processing reaction: ${error.message}`);
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
      case 'オンボーディング':
        await handleJapaneseOnboardingCommand(interaction);
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
      case 'flags':
        await handleFlagsCommand(interaction);
        break;
      case 'help':
        await handleHelpCommand(interaction);
        break;
      case 'get-translation':
        await handleGetTranslationCommand(interaction);
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

async function handleJapaneseOnboardingCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('📨 認証手順 (Verification Instructions)')
    .setDescription('認証とオンボーディングプロセスを開始するには：\n\n**1.** 私の名前（Region40Bot）をクリックしてください\n**2.** ダイレクトメッセージを送信してください\n**3.** 「verify」と入力してください\n**4.** オンボーディングの手順に従ってください\n\n*To verify and start your onboarding process:\n1. Click on my name (Region40Bot)\n2. Send me a direct message\n3. Type: "verify"\n4. Follow the onboarding steps*')
    .addFields([
      { 
        name: '💬 やること (What to do)', 
        value: '「verify」という単語でDMを送信してください\n*Send me a DM with the word "verify"*' 
      },
      { 
        name: '🤖 私を見つける場所 (Where to find me)', 
        value: 'メンバーリストまたはこのメッセージの「Region40Bot」をクリック\n*Click on "Region40Bot" in the member list or this message*' 
      },
      { 
        name: '⏰ 次に何が起こるか (What happens next)', 
        value: 'プロフィール設定とアライアンス選択をガイドします\n*I\'ll guide you through profile setup and alliance selection*' 
      }
    ])
    .setColor(0x00FF00)
    .setFooter({ text: '簡単な認証：「verify」とDMするだけで始められます！ | Simple verification: Just DM me "verify" to get started!' });
  
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
        language: 'en'
      });
      
      const embed = new EmbedBuilder()
        .setTitle('🚫 Language Preference Cleared')
        .setDescription('Your language preference has been reset to English.')
        .addFields([
          { name: '🏴 Translation Available', value: 'You can still translate messages by reacting with country flags' },
          { name: '🔄 Set Language Again', value: 'Use `/setlang <language>` anytime to set a new preference' }
        ])
        .setColor(0xFF6B6B);
      
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error clearing language:', error);
      return interaction.reply({ content: 'Error clearing language preference.', flags: MessageFlags.Ephemeral });
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
        language: lang
      });
    } else {
      await dbHelpers.updateUserProfile(interaction.user.id, { 
        language: lang
      });
    }
    
    // Get language name for display
    const langName = Object.keys(languageMap).find(key => languageMap[key] === lang) || lang;
    
    const embed = new EmbedBuilder()
      .setTitle('🌐 Language Preference Set!')
      .setDescription(`Your preferred language has been set to **${langName}** (${lang})`)
      .addFields([
        { name: '🏴 Flag Translation', value: 'React with country flags (🇺🇸🇪🇸🇫🇷🇩🇪) on any message to translate' },
        { name: '� Context Menu', value: 'Right-click any message → "Translate Message" for quick translation' },
        { name: '� Change Language', value: 'Use `/setlang <language>` to change your preference' },
        { name: '📋 View Flags', value: 'Use `/flags` to see all available country flags' }
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
    
    if (userProfile && userProfile.language) {
      const embed = new EmbedBuilder()
        .setTitle('🌐 Your Language Settings')
        .addFields([
          { name: 'Preferred Language:', value: `**${userProfile.language}**` },
          { name: 'Translation Method:', value: '🏴 React with country flags to translate messages' },
          { name: 'Change Language:', value: 'Use `/setlang <language>` to change' },
          { name: 'How to Translate:', value: 'React with any country flag on messages to translate to that language' }
        ])
        .setColor(0x00AE86);
      
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      const embed = new EmbedBuilder()
        .setTitle('🌐 Language Settings')
        .setDescription('You haven\'t set up your language preference yet.')
        .addFields([
          { name: 'Set Language:', value: 'Use `/setlang <language>` to set your language preference' },
          { name: 'Translation:', value: 'React with country flags 🇺🇸🇪🇸🇫🇷🇩🇪 on any message to translate' },
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
    // Check current onboarding status
    const userProfile = await dbHelpers.getUserProfile(user.id);
    
    // If user is already verified and in process, don't restart
    if (userProfile && userProfile.verified && userProfile.onboardingStep && userProfile.onboardingStep !== 'pending') {
      logVerification(`User ${user.username} already in onboarding process (${userProfile.onboardingStep}), skipping duplicate`);
      return;
    }
    
    // Set or update to profile step
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
            logVerification(`Removed "not-onboarded" role from ${user.username} in ${guild.name}`);
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
        { name: '🌐 Language', value: 'What is your preferred language?\n\n**Available codes:**\n`en` (English), `es` (Spanish), `fr` (French), `de` (German), `it` (Italian), `pt` (Portuguese), `ru` (Russian), `ja` (Japanese), `zh` (Chinese), `ko` (Korean), `ar` (Arabic), `nl` (Dutch), `pl` (Polish), `sv` (Swedish), `no` (Norwegian), `da` (Danish), `fi` (Finnish), `cs` (Czech), `hu` (Hungarian), `ro` (Romanian), `bg` (Bulgarian), `el` (Greek), `he` (Hebrew), `hi` (Hindi), `th` (Thai), `vi` (Vietnamese)\n\nYou can use either the code (e.g., `en`) or full name (e.g., `English`).' }
      ])
      .setColor(0x00FF00)
      .setFooter({ text: '⏰ Please reply with: IGN | Timezone | Language (separated by | symbol)' });
    
    await user.send({ embeds: [profileEmbed] });
    logVerification(`Sent profile setup message to ${user.username}`);
    
  } catch (error) {
    console.error('Error in automated onboarding:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Setup Error')
      .setDescription('There was an error starting your profile setup. Please try again or contact an administrator.')
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
        
      case 'start_onboarding':
        // Check if user is verified (either manually verified or force verified)
        const userProfile = await dbHelpers.getUserProfile(targetUser.id);
        
        if (!userProfile || !userProfile.verified) {
          return interaction.reply({ 
            content: `❌ User ${targetUser.username} must be verified first. Use the "Force verify" action or have them complete verification.`, 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        // Start the onboarding process
        try {
          await startAutomatedOnboarding(targetUser);
          return interaction.reply({ 
            content: `✅ Started onboarding profile setup for ${targetUser.username}. They will receive a DM with profile setup instructions.`, 
            flags: MessageFlags.Ephemeral 
          });
        } catch (onboardingError) {
          console.error('Error starting onboarding:', onboardingError);
          return interaction.reply({ 
            content: `❌ Failed to start onboarding for ${targetUser.username}. They may have DMs disabled or an error occurred.`, 
            flags: MessageFlags.Ephemeral 
          });
        }
        
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
    const devChannel = interaction.options.getChannel('dev_channel');
    
    const updateData = {};
    if (verificationChannel) updateData.verificationChannelId = verificationChannel.id;
    if (welcomeChannel) updateData.welcomeChannelId = welcomeChannel.id;
    if (modChannel) updateData.modChannelId = modChannel.id;
    if (devChannel) updateData.devChannelId = devChannel.id;
    
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
            name: 'Dev Channel', 
            value: currentSettings.devChannelId ? `<#${currentSettings.devChannelId}>` : 'Not set', 
            inline: true 
          },
          {
            name: 'Usage',
            value: 'Use `/setup verification_channel:#channel` to set verification channel\nUse `/setup welcome_channel:#channel` to set welcome channel\nUse `/setup mod_channel:#channel` to set mod notifications channel\nUse `/setup dev_channel:#channel` to set dev reports channel (12-hour onboarding reports)'
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
    if (devChannel) {
      embed.addFields({ name: 'Dev Channel', value: `<#${devChannel.id}>` + '\n*12-hour onboarding reports will be sent here*', inline: true });
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
    // Check if this interaction is happening in DMs
    if (!interaction.guild) {
      const embed = new EmbedBuilder()
        .setTitle('🔧 Permission Check - DM Mode')
        .setDescription('This command provides more detailed information when used in a server.')
        .addFields([
          { name: 'Bot Status', value: '✅ Online and responding to DMs' },
          { name: 'Translation', value: '✅ Flag-based translation available' },
          { name: 'User Commands', value: '✅ Profile, verification, and language commands work in DMs' },
          { name: 'Server Features', value: 'Role management and server-specific features require server context' }
        ])
        .setColor(0x00AE86);
      
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // Check if guild members are available
    if (!interaction.guild.members) {
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

async function handleFlagsCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🌍 Supported Country Flags for Translation')
    .setDescription('🎯 **Two ways to translate:**\n• **Reply** to a message with a flag emoji\n• **React** to a message with a flag emoji\n\nBoth methods work the same way!')
    .addFields([
      { 
        name: '🇺🇸 English Speaking Countries', 
        value: '🇺🇸🇬🇧🇨🇦🇦🇺🇳🇿🇮🇪🇿🇦🇯🇲🇹🇹🇧🇸🇧🇧🇬🇩🇱🇨🇻🇨🇦🇬🇩🇲🇰🇳🇬🇾🇧🇿🇲🇹🇸🇬🇭🇰🇵🇭🇮🇳🇳🇬🇰🇪🇺🇬🇬🇭🇹🇿🇿🇼🇧🇼🇿🇲🇲🇼🇸🇿🇱🇸🇳🇦🇱🇷🇸🇱🇬🇲🇫🇯🇻🇺🇸🇧🇵🇬🇼🇸🇹🇴🇰🇮🇹🇻🇳🇷🇵🇼🇲🇭🇫🇲', 
        inline: false 
      },
      { 
        name: '🇪🇸 Spanish Speaking Countries', 
        value: '🇪🇸🇲🇽🇦🇷🇨🇱🇨🇴🇵🇪🇻🇪🇺🇾🇪🇨🇧🇴🇵🇾🇬🇹🇨🇷🇵🇦🇳🇮🇭🇳🇸🇻🇩🇴🇨🇺🇵🇷🇬🇶', 
        inline: false 
      },
      { 
        name: '🇫🇷 French Speaking Countries', 
        value: '🇫🇷🇧🇪🇨🇭🇱🇺🇲🇨🇸🇳🇲🇱🇧🇫🇳🇪🇹🇩🇨🇫🇨🇲🇬🇦🇨🇬🇨🇩🇧🇯🇹🇬🇨🇮🇬🇳🇲🇬🇰🇲🇸🇨🇩🇯🇭🇹🇻🇺', 
        inline: false 
      },
      { 
        name: '🇩🇪 German Speaking', 
        value: '🇩🇪🇦🇹🇱🇮', 
        inline: true 
      },
      { 
        name: '🇵🇹 Portuguese Speaking', 
        value: '🇵🇹🇧🇷🇦🇴🇲🇿🇬🇼🇨🇻🇸🇹🇹🇱🇲🇴', 
        inline: true 
      },
      { 
        name: '🇮🇹 Italian Speaking', 
        value: '🇮🇹🇻🇦🇸🇲', 
        inline: true 
      },
      { 
        name: '🇷🇺 Russian Speaking', 
        value: '🇷🇺🇧🇾🇰🇿🇰🇬🇹🇯', 
        inline: true 
      },
      { 
        name: '🇸🇦 Arabic Speaking', 
        value: '🇸🇦🇦🇪🇪🇬🇮🇶🇯🇴🇱🇧🇸🇾🇾🇪🇴🇲🇰🇼🇶🇦🇧🇭🇲🇦🇹🇳🇩🇿🇱🇾🇸🇩🇸🇸🇪🇷🇩🇯🇰🇲🇲🇷🇵🇸', 
        inline: true 
      },
      { 
        name: '🇳🇱 Dutch Speaking', 
        value: '🇳🇱🇸🇷🇦🇼🇨🇼🇸🇽', 
        inline: true 
      },
      { 
        name: '🌏 Asian Languages', 
        value: '🇯🇵 Japanese • 🇨🇳🇹🇼 Chinese • 🇰🇷 Korean • 🇹🇭 Thai • 🇻🇳 Vietnamese\n🇮🇩 Indonesian • 🇲🇾 Malay • 🇵🇭 Filipino • 🇮🇳 Hindi/Bengali • 🇵🇰 Urdu\n🇰🇭 Khmer • 🇱🇦 Lao • 🇲🇲 Myanmar • 🇳🇵 Nepali • 🇱🇰 Sinhala • 🇧🇩 Bengali\n🇦🇫 Persian/Dari • 🇮🇷 Persian • 🇲🇳 Mongolian', 
        inline: false 
      },
      { 
        name: '🌍 European Languages', 
        value: '🇵🇱 Polish • 🇸🇪 Swedish • 🇳🇴 Norwegian • 🇩🇰 Danish • 🇫🇮 Finnish • 🇮🇸 Icelandic\n🇨🇿 Czech • 🇸🇰 Slovak • 🇭🇺 Hungarian • 🇷🇴🇲🇩 Romanian • 🇧🇬 Bulgarian\n🇬🇷🇨🇾 Greek • 🇮🇱 Hebrew • 🇹🇷 Turkish • 🇺🇦 Ukrainian • 🇭🇷 Croatian\n🇷🇸 Serbian • 🇧🇦 Bosnian • 🇸🇮 Slovenian • 🇦🇱🇽🇰 Albanian • 🇲🇰 Macedonian\n🇱🇻 Latvian • 🇱🇹 Lithuanian • 🇪🇪 Estonian • 🇦🇲 Armenian • 🇬🇪 Georgian\n🇦🇿 Azerbaijani • 🇺🇿 Uzbek • 🇹🇲 Turkmen', 
        inline: false 
      },
      { 
        name: '🌍 African Languages', 
        value: '🇿🇦 Afrikaans/Zulu/Xhosa • 🇰🇪🇹🇿🇺🇬 Swahili • 🇳🇬 Hausa/Yoruba/Igbo\n🇪🇹 Amharic • 🇷🇼 Kinyarwanda • 🇧🇮 Kirundi • 🇲🇬 Malagasy', 
        inline: false 
      },
      { 
        name: '🏝️ Regional & Celtic Languages', 
        value: '🇬🇧 Welsh/Scottish Gaelic • 🇮🇪 Irish Gaelic • 🇦🇩 Catalan • 🇪🇸 Basque/Galician\n🇱🇺 Luxembourgish • 🇫🇴 Faroese • 🇬🇱 Greenlandic', 
        inline: false 
      }
    ])
    .setColor(0x00FF7F)
    .setFooter({ text: '🎯 Total: 150+ country flags supported! Reply OR react to any message with a flag emoji!' })
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleHelpCommand(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🤖 Bot Help & Commands')
    .setDescription('Complete guide to bot features and commands')
    .addFields([
      { 
        name: '🔐 Onboarding Commands', 
        value: '`/verify` - Start verification process\n`/オンボーディング` - 日本語で認証開始\n`/profile` - Complete your profile\n`/alliance` - Choose your alliance', 
        inline: true 
      },
      { 
        name: '� Flag Translation System', 
        value: '**Two easy ways to translate any message:**\n\n🎯 **Method 1:** Reply to a message with a flag emoji\n🎯 **Method 2:** React to a message with a flag emoji\n\n🇺🇸🇬🇧🇨🇦 English • 🇪🇸🇲🇽🇦🇷 Spanish • 🇫🇷🇧🇪 French • 🇩🇪🇦🇹 German\n🇮🇹🇵🇹🇧🇷 Italian/Portuguese • 🇷🇺🇯🇵🇨🇳🇰🇷 Russian/Japanese/Chinese/Korean\n🇸🇦🇹🇭🇻🇳🇮🇩 Arabic/Thai/Vietnamese/Indonesian • **And 150+ more!**\n\n**Examples:**\n• Reply to "Hello" with 🇪🇸 → Get Spanish translation\n• React to "Hola" with 🇺🇸 → Get English translation', 
        inline: false 
      },
      { 
        name: '🌐 Other Translation', 
        value: '`/setlang <language>` - Set your language\n`/getlang` - View current language\n`/get-translation` - Get private translation', 
        inline: true 
      },
      { 
        name: '🛠️ Admin Commands', 
        value: '`/stats` - Server statistics\n`/setup` - Configure channels\n`/manage` - Advanced admin options', 
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
        value: '1. Use `/verify` to get verified\n2. Complete `/profile` with your info\n3. Choose `/alliance`\n4. Reply to messages with flag emojis OR react to messages with flag emojis for instant translations!', 
        inline: false 
      },
      { 
        name: '🏁 Quick Translation Guide', 
        value: '• Find a message you want translated\n• **Reply** to it with a country flag emoji (🇺🇸 🇪🇸 🇫🇷 etc.) OR\n• **React** to it with a country flag emoji\n• Get your private translation that auto-deletes in 45 seconds!\n• Works with 150+ country flags!', 
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

async function handleGetTranslationCommand(interaction) {
  try {
    const userId = interaction.user.id;
    const channelId = interaction.channel.id;
    const translationKey = `${userId}_${channelId}`;
    
    // Check if user has a pending translation in this channel
    if (!client.userTranslations || !client.userTranslations.has(translationKey)) {
      return await interaction.reply({
        content: '❌ No translation available for you in this channel.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    const translationData = client.userTranslations.get(translationKey);
    
    // Create the ephemeral translation embed
    const translationEmbed = new EmbedBuilder()
      .setAuthor({ 
        name: `Translation`,
        iconURL: translationData.authorAvatar
      })
      .setDescription(`**${translationData.originalAuthor}:** ${translationData.originalText}\n\n**Translation (${translationData.fromLang} → ${translationData.toLang}):** ${translationData.translatedText}`)
      .setColor(0x00AE86)
      .setTimestamp(translationData.timestamp)
      .setFooter({ text: `Only you can see this • Auto-translation` });

    // Send the truly ephemeral response
    await interaction.reply({
      embeds: [translationEmbed],
      flags: MessageFlags.Ephemeral
    });
    
    // Start 45-second timer only after user views it (and if they're online)
    const isOnline = isUserOnline(interaction.guild, userId);
    
    if (isOnline) {
      // User is online, start 45-second timer immediately
      setTimeout(async () => {
        try {
          await interaction.followUp({
            content: '⏰ Translation has expired.',
            flags: MessageFlags.Ephemeral
          });
        } catch (error) {
          // User might have left or interaction expired
        }
      }, 45000); // 45 seconds
      
      logTranslation(`Ephemeral translation sent to ${userId} - 45s timer started (user online)`);
    } else {
      // Monitor for when user comes online
      const checkUserStatus = setInterval(async () => {
        const isNowOnline = isUserOnline(interaction.guild, userId);
        if (isNowOnline) {
          clearInterval(checkUserStatus);
          
          // Start 45-second timer now that user is online
          setTimeout(async () => {
            try {
              await interaction.followUp({
                content: '⏰ Translation has expired.',
                flags: MessageFlags.Ephemeral
              });
            } catch (error) {
              // User might have left or interaction expired
            }
          }, 45000); // 45 seconds
          
          logTranslation(`Translation timer started for ${userId} (user came online)`);
        }
      }, 5000); // Check every 5 seconds
      
      // Stop checking after 10 minutes
      setTimeout(() => {
        clearInterval(checkUserStatus);
      }, 600000); // 10 minutes
      
      logTranslation(`Ephemeral translation sent to ${userId} - waiting for user to come online`);
    }
    
    // Remove the translation from storage after user views it
    client.userTranslations.delete(translationKey);
    
  } catch (error) {
    console.error('Error in handleGetTranslationCommand:', error);
    try {
      await interaction.reply({
        content: '❌ An error occurred while retrieving your translation.',
        flags: MessageFlags.Ephemeral
      });
    } catch (replyError) {
      console.error('Error sending error reply:', replyError);
    }
  }
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
  } else if (customId === 'remind_onboarding') {
    await handleRemindOnboarding(interaction);
  } else if (customId === 'view_oldest') {
    await handleViewOldest(interaction);
  }
}

// Handle onboarding reminder button
async function handleRemindOnboarding(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Check if user has admin permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return await interaction.editReply({ 
        content: '❌ You need Manage Server permissions to send onboarding reminders.' 
      });
    }

    const guild = interaction.guild;
    const notOnboardedRole = guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    if (!notOnboardedRole) {
      return await interaction.editReply({ 
        content: '❌ No "not-onboarded" role found in this server.' 
      });
    }

    const notOnboardedMembers = guild.members.cache.filter(member => 
      member.roles.cache.has(notOnboardedRole.id) && !member.user.bot
    );

    if (notOnboardedMembers.size === 0) {
      return await interaction.editReply({ 
        content: '✅ All members have completed onboarding!' 
      });
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const [, member] of notOnboardedMembers) {
      try {
        const reminderEmbed = new EmbedBuilder()
          .setTitle('📋 Onboarding Reminder')
          .setDescription(`Hello! You haven't completed the onboarding process in **${guild.name}** yet.`)
          .setColor('#FF6B6B')
          .addFields([
            { name: '🚀 Get Started', value: 'Send me a direct message with the word `verify` to begin onboarding', inline: false },
            { name: '📝 What You\'ll Do', value: '• Complete verification\n• Set up your profile\n• Choose your alliance\n• Set language preferences', inline: false },
            { name: '⏰ Why Complete It?', value: 'Onboarding unlocks full server access and features like translation!', inline: false }
          ])
          .setFooter({ text: `${guild.name} • Region40Bot`, iconURL: guild.iconURL() })
          .setTimestamp();

        await member.send({ embeds: [reminderEmbed] });
        sentCount++;
      } catch (error) {
        console.log(`Failed to send reminder to ${member.user.username}: ${error.message}`);
        failedCount++;
      }
    }

    const responseEmbed = new EmbedBuilder()
      .setTitle('📨 Onboarding Reminders Sent')
      .setColor('#00FF00')
      .addFields([
        { name: '✅ Successfully Sent', value: `${sentCount} reminders`, inline: true },
        { name: '❌ Failed to Send', value: `${failedCount} reminders`, inline: true },
        { name: '📊 Total Pending', value: `${notOnboardedMembers.size} members`, inline: true }
      ])
      .setFooter({ text: 'Note: Some users may have DMs disabled' });

    await interaction.editReply({ embeds: [responseEmbed] });

  } catch (error) {
    console.error('Error sending onboarding reminders:', error);
    await interaction.editReply({ 
      content: '❌ An error occurred while sending reminders. Please try again.' 
    });
  }
}

// Handle view oldest button
async function handleViewOldest(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    const notOnboardedRole = guild.roles.cache.find(role => role.name === 'not-onboarded');
    
    if (!notOnboardedRole) {
      return await interaction.editReply({ 
        content: '❌ No "not-onboarded" role found in this server.' 
      });
    }

    const notOnboardedMembers = guild.members.cache.filter(member => 
      member.roles.cache.has(notOnboardedRole.id) && !member.user.bot
    );

    if (notOnboardedMembers.size === 0) {
      return await interaction.editReply({ 
        content: '✅ All members have completed onboarding!' 
      });
    }

    // Sort by join date (oldest first)
    const sortedMembers = notOnboardedMembers.sort((a, b) => a.joinedAt - b.joinedAt);
    const oldestMembers = sortedMembers.first(10); // Show top 10 oldest

    const embed = new EmbedBuilder()
      .setTitle('⏰ Oldest Pending Onboarding Members')
      .setDescription('Members who joined earliest but haven\'t completed onboarding:')
      .setColor('#FFA500');

    let description = '';
    oldestMembers.forEach((member, index) => {
      const daysSinceJoin = Math.floor((Date.now() - member.joinedAt) / (1000 * 60 * 60 * 24));
      const joinDate = member.joinedAt.toLocaleDateString();
      description += `**${index + 1}.** ${member.user.username} (${member.user.tag})\n`;
      description += `   Joined: ${joinDate} (${daysSinceJoin} days ago)\n\n`;
    });

    embed.setDescription(description);
    embed.addFields([
      { name: '📊 Statistics', value: `Showing ${oldestMembers.length} of ${sortedMembers.size} pending members`, inline: false }
    ]);

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Error viewing oldest members:', error);
    await interaction.editReply({ 
      content: '❌ An error occurred while fetching member data. Please try again.' 
    });
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
      // Check if this is in a server context for role assignment
      if (!interaction.guild || !interaction.guild.members) {
        // If in DMs, just update the database without role assignment
        const selectedAllianceName = allianceNames[alliance];
        
        await dbHelpers.updateUserProfile(interaction.user.id, { alliance });
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Alliance Updated!')
          .setDescription(`You have selected **${selectedAllianceName}** as your alliance.`)
          .addFields([
            { name: 'Note', value: 'Role assignment will happen when you next interact in the server.' }
          ])
          .setColor(0x00AE86);
        
        return interaction.update({ embeds: [embed], components: [] });
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
      
      // Check if the interaction is still valid before trying to respond
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'Error translating message.', flags: MessageFlags.Ephemeral });
        } catch (replyError) {
          console.error('Failed to send error reply (interaction may have expired):', replyError.message);
        }
      } else {
        console.log('Interaction already replied to or expired, skipping error response');
      }
    }
  }
}

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't crash for unhandled rejections
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.log('Bot will restart in 3 seconds...');
  
  // Graceful shutdown
  setTimeout(() => {
    console.log('Restarting bot...');
    process.exit(1); // Exit with error code to trigger restart
  }, 3000);
});

// Discord client error handler
client.on('error', (error) => {
  console.error('Discord client error:', error);
  
  // For critical Discord connection errors, restart
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
    console.log('Critical connection error - restarting bot in 5 seconds...');
    setTimeout(() => {
      process.exit(1);
    }, 5000);
  }
});

// Handle process signals for graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT - shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM - shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
















