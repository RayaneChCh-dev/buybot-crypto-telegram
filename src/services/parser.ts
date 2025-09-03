import config from '../config';
import logger from '../utils/logger';

interface Instruction {
    programId: string;
}

interface DEXPrograms {
    [key: string]: string;
}

const DEX_PROGRAMS: DEXPrograms = {
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter', 
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

class TransactionParser {
    static parseHeliusTransaction(transaction: any) {
        try {
            const { signature, timestamp, events, instructions, feePayer } = transaction;
            
            if (!events?.swap || events.swap.length === 0) return null;

            let relevantSwap: { tokenInputs: any[], tokenOutputs: any[] } | null = null;

            for (const swap of events.swap) {
                const involvesOurToken = swap.tokenInputs?.some((i: any)=> i.mint === config.token.mintAddress) ||
                                         swap.tokenOutputs?.some((o: any)=> o.mint === config.token.mintAddress);
                if (involvesOurToken) {
                    relevantSwap = swap;
                    break;
                }
            }

            if (!relevantSwap) return null;

            // Detect buy vs sell
            const tokenOutput = relevantSwap.tokenOutputs?.find(o => o.mint === config.token.mintAddress);
            const tokenInput = relevantSwap.tokenInputs?.find(i => i.mint === config.token.mintAddress);
            const solInput = relevantSwap.tokenInputs?.find(i => i.mint === WSOL_MINT || i.mint === null);
            const solOutput = relevantSwap.tokenOutputs?.find(o => o.mint === WSOL_MINT || o.mint === null);

            let amountSol = 0;
            let tokens = 0;
            let type: 'BUY' | 'SELL' | 'UNKNOWN' = 'UNKNOWN';

            if (tokenOutput && solInput) {
                // Buy: SOL -> Token
                amountSol = solInput.tokenAmount / 1e9;
                tokens = tokenOutput.tokenAmount / Math.pow(10, config.token.decimals);
                type = 'BUY';
            } else if (tokenInput && solOutput) {
                // Sell: Token -> SOL
                amountSol = solOutput.tokenAmount / 1e9;
                tokens = tokenInput.tokenAmount / Math.pow(10, config.token.decimals);
                type = 'SELL';
            } else {
                return null; // Other swap types we don't care about
            }

            const pricePerToken = tokens > 0 ? amountSol / tokens : 0;
            const dex = this.getDEXFromInstructions(instructions);
            const isWhale = amountSol >= config.features.whaleThreshold;

            return {
                signature,
                buyer: feePayer || 'Unknown',
                amountSol,
                tokensBought: tokens,
                pricePerToken,
                type,
                timestamp: new Date(timestamp * 1000),
                dex,
                isWhale,
                raw: transaction
            };
        } catch (error: any) {
            logger.error('Error parsing transaction:', error);
            return null;
        }
    }

    static getDEXFromInstructions(instructions: Instruction[] = []) {
        for (const inst of instructions) {
            const name = DEX_PROGRAMS[inst.programId];
            if (name) return name;
        }
        return 'Unknown DEX';
    }

    static formatNumber(num: number, decimals = 2) {
        if (num >= 1e9) return (num / 1e9).toFixed(decimals) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(decimals) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(decimals) + 'K';
        return num.toFixed(decimals);
    }
}

export default TransactionParser;
