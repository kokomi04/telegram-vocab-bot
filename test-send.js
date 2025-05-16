const dotenv = require('dotenv');
const botModule = require('./bot');

// Load environment variables
dotenv.config();

async function testSendVocabulary() {
    console.log('Starting vocabulary send test to channel...');

    try {
        // Initialize database
        await botModule.initDb();
        console.log('Database initialized successfully');

        // Test sending words to channel
        console.log('Testing sendDailyWordsToChannel function...');
        await botModule.sendDailyWordsToChannel();
        console.log('Words sent to channel successfully');

        // Test scheduling
        console.log('\nTesting scheduler...');
        const schedule = require('node-schedule');
        const testTime = new Date();
        testTime.setSeconds(testTime.getSeconds() + 10); // Schedule for 10 seconds from now

        console.log(`Scheduling test job for ${testTime.toLocaleTimeString()}`);
        const job = schedule.scheduleJob(testTime, async () => {
            console.log('\nExecuting scheduled job...');
            try {
                await botModule.sendDailyWordsToChannel();
                console.log('Scheduled job completed successfully');
            } catch (error) {
                console.error('Error in scheduled job:', error);
            } finally {
                cleanupAndExit(0);
            }
        });

        console.log('Waiting for scheduled job...');
    } catch (error) {
        console.error('Test failed:', error);
        cleanupAndExit(1);
    }
}

function cleanupAndExit(code) {
    console.log('\nCleaning up...');
    if (botModule.bot) {
        botModule.bot.stopPolling();
    }
    setTimeout(() => process.exit(code), 1000);
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\nReceived SIGINT signal');
    cleanupAndExit(0);
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM signal');
    cleanupAndExit(0);
});

// Run the test
console.log('Starting vocabulary bot test...');
testSendVocabulary().catch(error => {
    console.error('Fatal error:', error);
    cleanupAndExit(1);
});
