const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

// Load environment variables
dotenv.config();

// Configuration
const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://duypham:741852963@cluster0.y6e6y2l.mongodb.net/vocab';
const DB_NAME = 'vocabulary_bot';
const WORD_FILE = path.join(__dirname, 'words.txt');
const SEND_TIME_HOUR = 8;
const SEND_TIME_MINUTE = 0;
const WORDS_PER_DAY = 10;
const PORT = process.env.PORT || 3000;

// Validate required environment variables
if (!TOKEN || !CHANNEL_ID) {
    console.error('Missing required environment variables. Please check BOT_TOKEN and CHANNEL_ID.');
    process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(TOKEN, { polling: true });

// Global variables
let allWords = [];
let db;
let client;
const wordDetailsCache = new Map();

// Database initialization
async function initDb() {
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to MongoDB');
        
        db = client.db(DB_NAME);
        
        // Create collections and indexes
        const collections = ['users', 'channel_words', 'word_details_cache'];
        const indexes = [
            { collection: 'users', field: 'chat_id', unique: true },
            { collection: 'channel_words', field: 'word', unique: true },
            { collection: 'word_details_cache', field: 'word', unique: true }
        ];

        for (const collection of collections) {
            await db.createCollection(collection);
        }

        for (const { collection, field, unique } of indexes) {
            await db.collection(collection).createIndex({ [field]: 1 }, { unique });
        }
        
        console.log('Database collections and indexes created');
        return db;
    } catch (error) {
        console.error('Database connection error:', error);
        throw error;
    }
}

// User management functions
async function getUser(chatId) {
    try {
        const user = await db.collection('users').findOne({ chat_id: chatId });
        return user ? {
            index: user.current_word_index,
            shuffledIndices: user.shuffled_indices
        } : null;
    } catch (error) {
        console.error(`Error fetching user ${chatId}:`, error);
        throw error;
    }
}

async function addNewUser(chatId, initialIndex, shuffledIndices) {
    try {
        const result = await db.collection('users').insertOne({
            chat_id: chatId,
            current_word_index: initialIndex,
            shuffled_indices: shuffledIndices,
            created_at: new Date()
        });
        console.log(`Added new user: ${chatId}`);
        return result.insertedId;
    } catch (error) {
        console.error(`Error adding new user ${chatId}:`, error);
        throw error;
    }
}

async function updateUserIndex(chatId, newIndex) {
    try {
        const result = await db.collection('users').updateOne(
            { chat_id: chatId },
            { 
                $set: { 
                    current_word_index: newIndex,
                    updated_at: new Date()
                }
            }
        );
        return result.modifiedCount;
    } catch (error) {
        console.error(`Error updating index for user ${chatId}:`, error);
        throw error;
    }
}

// Channel words management
async function getSentChannelWords() {
    try {
        const words = await db.collection('channel_words').find({}).toArray();
        return words.map(word => word.word);
    } catch (error) {
        console.error('Error fetching sent channel words:', error);
        throw error;
    }
}

async function addChannelWords(words) {
    if (!words?.length) return 0;
    
    try {
        const today = new Date().toISOString().split('T')[0];
        const operations = words.map(word => ({
            updateOne: {
                filter: { word },
                update: { 
                    $set: { 
                        word,
                        sent_date: today,
                        updated_at: new Date()
                    }
                },
                upsert: true
            }
        }));
        
        const result = await db.collection('channel_words').bulkWrite(operations);
        console.log(`Added ${result.upsertedCount} new words to channel_words collection`);
        return result.upsertedCount;
    } catch (error) {
        console.error('Error adding channel words:', error);
        throw error;
    }
}

// Word management
function loadWords(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const words = fileContent.split('\n')
            .map(line => line.trim())
            .filter(Boolean);
        
        console.log(`Loaded ${words.length} words from ${filePath}`);
        return words;
    } catch (error) {
        console.error(`Error loading word file ${filePath}:`, error);
        return [];
    }
}

function shuffleArray(array) {
    return array
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);
}

// Dictionary API integration
async function getWordDetails(word) {
    if (wordDetailsCache.has(word)) {
        return wordDetailsCache.get(word);
    }
    
    try {
        const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!response.data?.length) return null;

        const wordData = response.data[0];
        const result = {
            word: wordData.word,
            phonetic: wordData.phonetic || wordData.phonetics?.[0]?.text || '',
            meanings: wordData.meanings?.slice(0, 1).map(meaning => ({
                partOfSpeech: meaning.partOfSpeech,
                definition: meaning.definitions?.[0]?.definition
            })) || []
        };

        // Cache the result
        wordDetailsCache.set(word, result);
        await db.collection('word_details_cache').updateOne(
            { word },
            { 
                $set: {
                    ...result,
                    meanings_json: JSON.stringify(result.meanings),
                    last_updated: new Date()
                }
            },
            { upsert: true }
        );

        return result;
    } catch (error) {
        console.error(`Error fetching details for word "${word}":`, error);
        return null;
    }
}

// Message formatting
async function formatWordWithDetails(word) {
    try {
        const details = await getWordDetails(word);
        if (!details) {
            return `• *${word}* [📖](https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)})`;
        }

        let formattedWord = `• *${word}*`;
        if (details.phonetic) {
            formattedWord += ` ${details.phonetic}`;
        }
        
        formattedWord += '\n';
        
        if (details.meanings?.[0]) {
            const meaning = details.meanings[0];
            if (meaning.partOfSpeech) {
                formattedWord += ` (_${meaning.partOfSpeech}_)`;
            }
            if (meaning.definition) {
                const definition = meaning.definition.length > 80 
                    ? meaning.definition.substring(0, 77) + '...'
                    : meaning.definition;
                formattedWord += `: ${definition}`;
            }
        }
        
        formattedWord += ` [📖](https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)})`;
        return formattedWord;
    } catch (error) {
        console.error(`Error formatting word "${word}":`, error);
        return `• *${word}* [📖](https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)})`;
    }
}

// Helper function to send words to a user
async function sendWordsToUser(chatId, startIndex, shuffledIndices) {
    if (!allWords.length) {
        console.error("No words available to send.");
        return false;
    }

    const wordsToSend = [];
    const numShuffledIndices = shuffledIndices.length;
    const numWordsInList = allWords.length;

    for (let i = 0; i < WORDS_PER_DAY; i++) {
        const indexInShuffled = (startIndex + i) % numShuffledIndices;
        const actualWordIndex = shuffledIndices[indexInShuffled];
        if (actualWordIndex >= 0 && actualWordIndex < numWordsInList) {
            wordsToSend.push(allWords[actualWordIndex]);
        }
    }

    if (!wordsToSend.length) {
        console.warn(`No valid words found to send for user ${chatId}. Skipping message.`);
        return false;
    }

    try {
        const wordDetailsPromises = wordsToSend.map(word => getWordDetails(word));
        const wordDetailsResults = await Promise.all(wordDetailsPromises);
        
        let messageText = `📚 *Your Vocabulary Words* 📚\n\n`;
        
        for (const details of wordDetailsResults) {
            if (!details) continue;
            messageText += await formatWordWithDetails(details.word) + '\n\n';
        }
        
        messageText += `_Click on the 📖 icon to see more details in Cambridge Dictionary._`;
        
        if (wordDetailsResults.length < WORDS_PER_DAY) {
            messageText += `\n\n_(Note: Only ${wordDetailsResults.length} words sent due to list size or errors.)_`;
        }
        
        await bot.sendMessage(chatId, messageText, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
        
        console.log(`Sent ${wordDetailsResults.length} words with details to ${chatId}`);
        return true;
    } catch (error) {
        console.error(`Error sending formatted message to ${chatId}:`, error);
        
        // Fallback to simple format
        try {
            let messageText = `📚 *Your Vocabulary Words* 📚\n\n`;
            for (const word of wordsToSend) {
                messageText += `• *${word}* [📖](https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)})\n`;
            }
            
            if (wordsToSend.length < WORDS_PER_DAY) {
                messageText += `\n\n_(Note: Only ${wordsToSend.length} words sent due to list size or errors.)_`;
            }
            
            await bot.sendMessage(chatId, messageText, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            console.log(`Sent ${wordsToSend.length} words to ${chatId} (simple format)`);
            return true;
        } catch (fallbackError) {
            console.error(`Error sending fallback message to ${chatId}:`, fallbackError);
            return false;
        }
    }
}

// Daily job function
async function sendDailyWordsToChannel() {
    console.log("Running daily word send job to channel.");

    if (!allWords.length) {
        console.error("Daily job skipped: Word list is empty.");
        return;
    }

    try {
        const sentWords = await getSentChannelWords();
        console.log(`Found ${sentWords.length} words already sent to channel.`);

        const availableWords = allWords.filter(word => !sentWords.includes(word));

        if (!availableWords.length) {
            console.log("All words have been sent to the channel. Resetting sent words tracking.");
            const shuffledWords = shuffleArray([...allWords]);
            const wordsToSend = shuffledWords.slice(0, Math.min(WORDS_PER_DAY, shuffledWords.length));
            
            if (!wordsToSend.length) {
                console.warn("No valid words found to send. Skipping message.");
                return;
            }

            await sendFormattedWordsToChannel(wordsToSend, true);
            return;
        }

        const shuffledAvailable = shuffleArray(availableWords);
        const wordsToSend = shuffledAvailable.slice(0, Math.min(WORDS_PER_DAY, shuffledAvailable.length));

        if (!wordsToSend.length) {
            console.warn("No valid words found to send. Skipping message.");
            return;
        }

        await sendFormattedWordsToChannel(wordsToSend, false);

    } catch (error) {
        console.error("Error in sendDailyWordsToChannel:", error);
    }
}

// Function to send formatted words to channel
async function sendFormattedWordsToChannel(wordsToSend, isReset) {
    try {
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const wordDetailsPromises = wordsToSend.map(word => getWordDetails(word));
        const wordDetailsResults = await Promise.all(wordDetailsPromises);
        
        let messageText = `📚 *Daily Vocabulary - ${dateStr}* 📚\n\n`;
        
        for (const details of wordDetailsResults) {
            if (!details) continue;
            messageText += await formatWordWithDetails(details.word) + '\n\n';
        }
        
        messageText += `_Click on the 📖 icon to see more details in Cambridge Dictionary._`;
        
        await bot.sendMessage(CHANNEL_ID, messageText, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
        
        console.log(`Sent ${wordsToSend.length} words with details to channel ${CHANNEL_ID}${isReset ? ' (after reset)' : ''}`);
        
        await addChannelWords(wordsToSend);
        return true;
    } catch (error) {
        console.error("Error in sendFormattedWordsToChannel:", error);
        
        // Fallback to simple format
        try {
            const today = new Date();
            const dateStr = today.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            let messageText = `📚 Daily Vocabulary - ${dateStr} 📚\n\n`;
            
            for (const word of wordsToSend) {
                messageText += `• *${word}* [📖](https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)})\n`;
            }
            
            await bot.sendMessage(CHANNEL_ID, messageText, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            console.log(`Sent ${wordsToSend.length} words to channel ${CHANNEL_ID} (simple format)`);
            
            await addChannelWords(wordsToSend);
            return true;
        } catch (fallbackError) {
            console.error("Error sending fallback message:", fallbackError);
            return false;
        }
    }
}

// Load word details cache from database
async function loadWordDetailsCache() {
    try {
        const rows = await db.collection('word_details_cache').find({}).toArray();
        
        for (const row of rows) {
            try {
                const meanings = JSON.parse(row.meanings_json || '[]');
                wordDetailsCache.set(row.word, {
                    word: row.word,
                    phonetic: row.phonetic || '',
                    meanings: meanings
                });
            } catch (jsonErr) {
                console.error(`Error parsing meanings_json for word ${row.word}:`, jsonErr);
            }
        }
        
        console.log(`Loaded ${wordDetailsCache.size} words into details cache.`);
    } catch (error) {
        console.error('Error loading word details cache:', error);
    }
}

// Bot command handlers
bot.onText(/^\/words$/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`Received /words from ${chatId}`);
    
    const processingMessage = await bot.sendMessage(
        chatId, 
        "Processing your request. Preparing vocabulary words...",
        { parse_mode: 'Markdown' }
    );

    if (!allWords.length) {
        await bot.sendMessage(chatId, "Sorry, the word list could not be loaded. Please contact the administrator.");
        return;
    }

    try {
        let userData = await getUser(chatId);
        let currentIndex = 0;
        let shuffledIndices;

        // If user doesn't exist, create new user
        if (!userData) {
            shuffledIndices = shuffleArray(Array.from({ length: allWords.length }, (_, i) => i));
            await addNewUser(chatId, currentIndex, shuffledIndices);
            console.log(`New user ${chatId} registered and will receive first batch of words`);
        } else {
            // Use existing user data
            currentIndex = userData.index;
            shuffledIndices = userData.shuffledIndices;

            // Regenerate shuffled indices if invalid
            if (!shuffledIndices?.length || shuffledIndices.length < allWords.length) {
                shuffledIndices = shuffleArray(Array.from({ length: allWords.length }, (_, i) => i));
                currentIndex = 0;
                await db.collection('users').updateOne(
                    { chat_id: chatId },
                    { $set: { current_word_index: currentIndex, shuffled_indices: shuffledIndices } }
                );
            }
        }

        const success = await sendWordsToUser(chatId, currentIndex, shuffledIndices);
        if (success) {
            const newIndex = (currentIndex + WORDS_PER_DAY) % shuffledIndices.length;
            await updateUserIndex(chatId, newIndex);
            await bot.deleteMessage(chatId, processingMessage.message_id);
        } else {
            await bot.editMessageText(
                "Sorry, there was an error processing your request. Please try again later.",
                {
                    chat_id: chatId,
                    message_id: processingMessage.message_id,
                    parse_mode: 'Markdown'
                }
            );
        }
    } catch (error) {
        console.error(`Error in /words handler for user ${chatId}:`, error);
        try {
            await bot.editMessageText(
                "An error occurred while sending words. Please try again later.",
                {
                    chat_id: chatId,
                    message_id: processingMessage.message_id,
                    parse_mode: 'Markdown'
                }
            );
        } catch (editError) {
            await bot.sendMessage(chatId, "An error occurred while sending words. Please try again later.");
        }
    }
});

// Main function
async function main() {
    console.log("Bot starting...");

    // Load words
    allWords = loadWords(WORD_FILE);
    if (!allWords.length) {
        console.error("Could not load words from the file. The bot cannot function without words.");
        process.exit(1);
    }

    // Initialize Database
    try {
        await initDb();
        await loadWordDetailsCache(); // Load cache after DB initialization
    } catch (error) {
        console.error("Failed to initialize database. Exiting.", error);
        process.exit(1);
    }

    // Schedule daily job
    schedule.scheduleJob(`${SEND_TIME_MINUTE} ${SEND_TIME_HOUR} * * *`, sendDailyWordsToChannel);
    console.log(`Daily word job scheduled for ${SEND_TIME_HOUR}:${SEND_TIME_MINUTE} (server time).`);

    // Handle graceful shutdown
    const handleShutdown = async () => {
        console.log("Shutting down bot and closing DB connection.");
        bot.stopPolling();
        if (client) {
            await client.close();
            console.log('MongoDB connection closed.');
        }
        process.exit(0);
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
}

// Start the bot
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});