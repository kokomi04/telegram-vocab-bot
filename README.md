# Telegram Vocabulary Bot

A simple Telegram bot that sends daily English vocabulary words to a channel and allows users to request words individually.

## Features

- Sends a configurable number of English vocabulary words daily to a channel
- Allows users to request vocabulary words individually using commands
- Uses SQLite database to track user progress
- Shuffles word list for each user for variety
- Handles edge cases gracefully

## Setup

1. Create a new Telegram bot by talking to [@BotFather](https://t.me/botfather) on Telegram
2. Get your bot token from BotFather
3. Create a `.env` file in the project root with this content:
   ```
   BOT_TOKEN=your_telegram_bot_token
   CHANNEL_ID=your_telegram_channel_id
   ```
4. Install dependencies:
   ```
   npm install
   ```

## Running the Bot

To start the bot:

```
npm start
```

The bot will:
- Load words from `words_unique.txt` (or `words.txt` if the unique file doesn't exist)
- Initialize the SQLite database
- Schedule a daily job to send words to the channel
- Start listening for Telegram commands

## Getting Chat IDs & Adding Users

When users interact with your bot by sending the `/start` command, they are automatically added to the database.

### Method 1: Interactive Bot

To manually get a chat ID and add it to the database interactively:

```
npm run get-chat-id
```

This will:
1. Start a temporary bot instance
2. Display any incoming chat IDs in the console
3. Add the chat ID to the database with default settings
4. Tell the user their chat ID

### Method 2: Direct Command

If you already know the chat ID, you can add it directly:

```
npm run add-user CHAT_ID
```

For example:
```
npm run add-user 123456789
```

After adding a user with either method, they can use the `/start` command to set up their word list properly.

## Testing

To test sending vocabulary words to users without waiting for the scheduled time:

```
npm run test-send
```

This will:
- Send vocabulary words to the channel immediately
- Not set up any schedules
- Exit after completion

## Available Commands

- `/start` - Subscribe to daily words and receive your first set immediately
- `/words` - Manually request your next set of words

## Customizing

You can adjust the following settings in `bot.js`:
- `SEND_TIME_HOUR` and `SEND_TIME_MINUTE` - Time to send daily words
- `WORDS_PER_DAY` - Number of words to send each day (will be automatically adjusted if there aren't enough words)

## Notes

- The bot uses the server's local time zone for scheduling
- The `words_unique.txt` file contains deduplicated words from the original `words.txt`