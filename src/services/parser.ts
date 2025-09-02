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
    'PhoeNiX7VjjpGxLKn6YCwXJvT4XhUdLQJPf1Dc2tPx8': 'Photon',
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca'
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

class TransactionParser {
    static parseHeliusTransaction(transaction: any) {
        try {
            const { description, signature, timestamp, events, instructions, feePayer } = transaction;
            
            if (!events?.swap || events.swap.length === 0) {
                return null;
            }

            // Find swap involving our token
            let relevantSwap: { tokenInputs: any[], tokenOutputs: any[] } | null = null;
            for (const swap of events.swap) {
                const hasOurToken = swap.tokenInputs?.some((input: any) => input.mint === config.token.mintAddress) ||
                                  swap.tokenOutputs?.some((output: any) => output.mint === config.token.mintAddress);
                if (hasOurToken) {
                    relevantSwap = swap;
                    break;
                }
            }

            if (!relevantSwap) return null;

            // Check if this is a buy (SOL -> Token)
            const tokenOutput = relevantSwap.tokenOutputs?.find(output => 
                output.mint === config.token.mintAddress);
            const tokenInput = relevantSwap.tokenInputs?.find(input => 
                input.mint === config.token.mintAddress);
            
            const isBuy = tokenOutput && !tokenInput;
            if (!isBuy) return null;

            // Extract buy data
            const solInput = relevantSwap.tokenInputs?.find(input => input.mint === WSOL_MINT);
            const amountSol = solInput ? solInput.tokenAmount / 1e9 : 0;
            const tokensBought = tokenOutput ? tokenOutput.tokenAmount / Math.pow(10, config.token.decimals) : 0;
            const pricePerToken = tokensBought > 0 ? amountSol / tokensBought : 0;

            // Determine DEX
            const dex = this.getDEXFromInstructions(instructions);
            
            // Check if whale
            const isWhale = amountSol >= config.features.whaleThreshold;

            return {
                signature,
                buyer: feePayer || 'Unknown',
                amountSol,
                tokensBought,
                pricePerToken,
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
        for (const instruction of instructions) {
            const dexName = DEX_PROGRAMS[instruction.programId];
            if (dexName) return dexName;
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