import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot';
import express from 'express';
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TOKEN_MINT_ADDRESS = process.env.TOKEN_MINT_ADDRESS;
const PORT = process.env.PORT;

// Initialize bot and express app
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

// Helius connection
const heliusConnection = new Connection(`https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`);

// DEX Program IDs
const DEX_PROGRAMS = {
    RAYDIUM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    JUPITER: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    PHOTON: 'PhoeNiX7VjjpGxLKn6YCwXJvT4XhUdLQJPf1Dc2tPx8', // Example - verify this
    ORCA: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP'
};

// In-memory storage (use database in production)
let tokenStats = {
    totalRaised: 0,
    totalHolders: 0,
    transactions: []
};

// 1. Setup Helius Webhook
async function setupHeliusWebhook() {
    const webhookURL = process.env.WEBHOOK_URL || `https://your-ngrok-url.ngrok.io/webhook`; // Replace with your ngrok URL
    
    const webhookConfig = {
        webhookURL: webhookURL,
        transactionTypes: ['SWAP'],
        accountAddresses: [TOKEN_MINT_ADDRESS],
        webhookType: 'enhanced'
    };

    try {
        const response = await axios.post(
            `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`,
            webhookConfig
        );
        console.log('Webhook created:', response.data);
    } catch (error) {
        console.error('Error creating webhook:', error.response?.data || error.message);
    }
}

// 2. Parse Helius transaction data
function parseHeliusTransaction(transaction) {
    try {
        const { description, signature, timestamp, events } = transaction;
        
        // Find swap events
        const swapEvents = events?.swap || [];
        let relevantSwap = null;
        
        for (const swap of swapEvents) {
            // Check if this swap involves our token
            if (swap.tokenInputs?.some(input => input.mint === TOKEN_MINT_ADDRESS) ||
                swap.tokenOutputs?.some(output => output.mint === TOKEN_MINT_ADDRESS)) {
                relevantSwap = swap;
                break;
            }
        }
        
        if (!relevantSwap) return null;
        
        // Determine if this is a buy (SOL -> Token) or sell (Token -> SOL)
        const tokenInput = relevantSwap.tokenInputs?.find(input => input.mint === TOKEN_MINT_ADDRESS);
        const tokenOutput = relevantSwap.tokenOutputs?.find(output => output.mint === TOKEN_MINT_ADDRESS);
        
        const isBuy = tokenOutput && !tokenInput; // User gets tokens, gives SOL
        
        if (!isBuy) return null; // We only want buy transactions
        
        // Extract buy data
        const solInput = relevantSwap.tokenInputs?.find(input => 
            input.mint === 'So11111111111111111111111111111111111111112' // Wrapped SOL
        );
        
        const amountSol = solInput ? solInput.tokenAmount / 1e9 : 0;
        const tokensBought = tokenOutput ? tokenOutput.tokenAmount : 0;
        const pricePerToken = tokensBought > 0 ? amountSol / tokensBought : 0;
        
        // Extract buyer address
        const buyer = transaction.feePayer || 'Unknown';
        
        // Determine DEX
        const dex = getDEXFromTransaction(transaction);
        
        return {
            signature,
            buyer,
            amountSol: amountSol.toFixed(4),
            tokensBought: tokensBought.toLocaleString(),
            pricePerToken: pricePerToken.toFixed(8),
            timestamp: new Date(timestamp * 1000),
            dex
        };
    } catch (error) {
        console.error('Error parsing transaction:', error);
        return null;
    }
}

// 3. Determine which DEX was used
function getDEXFromTransaction(transaction) {
    const instructions = transaction.instructions || [];
    
    for (const instruction of instructions) {
        const programId = instruction.programId;
        
        if (programId === DEX_PROGRAMS.RAYDIUM) return 'Raydium';
        if (programId === DEX_PROGRAMS.JUPITER) return 'Jupiter';
        if (programId === DEX_PROGRAMS.PHOTON) return 'Photon';
        if (programId === DEX_PROGRAMS.ORCA) return 'Orca';
    }
    
    return 'Unknown DEX';
}

// 4. Get current token metrics
async function getTokenMetrics() {
    try {
        // Get token supply and holder count using Helius
        const response = await axios.post(
            `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_API_KEY}`,
            {
                mintAccounts: [TOKEN_MINT_ADDRESS]
            }
        );
        
        const tokenData = response.data[0];
        const supply = tokenData?.onChainMetadata?.metadata?.supply || 0;
        
        // Get holder count (this might require a separate API call)
        const holdersResponse = await axios.get(
            `https://api.helius.xyz/v0/addresses/${TOKEN_MINT_ADDRESS}/balances?api-key=${HELIUS_API_KEY}`
        );
        
        const holders = holdersResponse.data?.filter(holder => holder.amount > 0)?.length || 0;
        
        return {
            totalHolders: holders,
            supply: supply
        };
    } catch (error) {
        console.error('Error fetching token metrics:', error);
        return { totalHolders: tokenStats.totalHolders, supply: 0 };
    }
}

// 5. Send Telegram notification
async function sendTelegramNotification(tradeData) {
    try {
        const metrics = await getTokenMetrics();
        
        // Update stats
        tokenStats.totalRaised += parseFloat(tradeData.amountSol);
        tokenStats.totalHolders = metrics.totalHolders;
        tokenStats.transactions.push(tradeData);
        
        // Format message
        const message = `
🚀 **NEW PURCHASE ON ${tradeData.dex.toUpperCase()}!**

💰 **Amount**: ${tradeData.amountSol} SOL
🪙 **Tokens Bought**: ${tradeData.tokensBought}
💵 **Price Per Token**: $${tradeData.pricePerToken}
📊 **Total Raised**: ${tokenStats.totalRaised.toFixed(2)} SOL
👥 **Total Holders**: ${tokenStats.totalHolders}
⏰ **Time**: ${tradeData.timestamp.toLocaleString()}

🔗 **Transaction**: [View on Solscan](https://solscan.io/tx/${tradeData.signature})

🤖 *Powered by ${tradeData.dex}*
`;

        await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
        
        console.log(`Notification sent for transaction: ${tradeData.signature}`);
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
}

// 6. Webhook endpoint to receive Helius data
app.post('/webhook', async (req, res) => {
    try {
        const transactions = req.body;
        
        if (!Array.isArray(transactions)) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        
        for (const transaction of transactions) {
            const tradeData = parseHeliusTransaction(transaction);
            
            if (tradeData) {
                await sendTelegramNotification(tradeData);
            }
        }
        
        res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 7. Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        totalTransactions: tokenStats.transactions.length,
        totalRaised: tokenStats.totalRaised,
        totalHolders: tokenStats.totalHolders
    });
});

// 8. Alternative: Polling method (if webhook doesn't work)
async function pollForTransactions() {
    try {
        const signatures = await heliusConnection.getSignaturesForAddress(
            new PublicKey(TOKEN_MINT_ADDRESS),
            { limit: 5 }
        );
        
        for (const sig of signatures) {
            // Check if we already processed this transaction
            if (tokenStats.transactions.some(tx => tx.signature === sig.signature)) {
                continue;
            }
            
            // Get enhanced transaction data from Helius
            const response = await axios.post(
                `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`,
                {
                    transactions: [sig.signature]
                }
            );
            
            const transactionData = response.data[0];
            if (transactionData) {
                const tradeData = parseHeliusTransaction(transactionData);
                if (tradeData) {
                    await sendTelegramNotification(tradeData);
                }
            }
        }
    } catch (error) {
        console.error('Polling error:', error);
    }
}

// 9. Initialize the bot
async function startBot() {
    console.log('Starting Telegram bot with Helius integration...');
    
    // Setup webhook (comment out if using polling)
    await setupHeliusWebhook();
    
    // Or use polling method (uncomment if webhook doesn't work)
    setInterval(pollForTransactions, 10000); // Poll every 10 seconds
    
    // Start express server for webhook
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
        console.log(`Health check: http://localhost:${PORT}/health`);
    });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    process.exit(0);
});

// Start the bot
startBot().catch(console.error);

export { startBot, sendTelegramNotification };