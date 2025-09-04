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
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'Raydium CPMM',
};

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

class TransactionParser {
    static parseHeliusTransaction(transaction: any) {
        try {
            const { signature, timestamp, events, instructions, feePayer, source } = transaction;
            
            // FIXED: Handle both object and array formats for events.swap
            if (!events?.swap) return null;

            let swaps: any[] = [];
            
            // Handle both object and array formats
            if (Array.isArray(events.swap)) {
                swaps = events.swap;
            } else if (typeof events.swap === 'object') {
                // Single swap object - convert to array
                swaps = [events.swap];
            } else {
                logger.debug('Invalid swap format:', events.swap);
                return null;
            }

            if (swaps.length === 0) return null;

            // Find swap involving our token
            let relevantSwap: any = null;

            for (const swap of swaps) {
                const involvesOurToken = this.swapInvolvesToken(swap, config.token.mintAddress);
                if (involvesOurToken) {
                    relevantSwap = swap;
                    break;
                }
            }

            if (!relevantSwap) return null;

            // Parse the swap details
            const swapDetails = this.parseSwapDetails(relevantSwap);
            if (!swapDetails) return null;

            const dex = source || this.getDEXFromInstructions(instructions);
            const isWhale = swapDetails.amountSol >= config.features.whaleThreshold;

            return {
                signature,
                buyer: feePayer || 'Unknown',
                amountSol: swapDetails.amountSol,
                tokensBought: swapDetails.tokens,
                pricePerToken: swapDetails.pricePerToken,
                type: swapDetails.type,
                timestamp: new Date(timestamp * 1000),
                dex,
                isWhale,
                raw: transaction,
            };
        } catch (error: any) {
            logger.error('Error parsing transaction:' + JSON.stringify({
                message: error.message,
                stack: error.stack,
                signature: transaction?.signature,
            }, null, 2));
            return null;
        }
    }

    static swapInvolvesToken(swap: any, tokenMint: string): boolean {
        // Check tokenInputs and tokenOutputs
        const tokenInputs = swap.tokenInputs || [];
        const tokenOutputs = swap.tokenOutputs || [];
        
        const hasTokenInput = tokenInputs.some((input: any) => 
            input?.mint === tokenMint || input?.rawTokenAmount?.mint === tokenMint
        );
        const hasTokenOutput = tokenOutputs.some((output: any) => 
            output?.mint === tokenMint || output?.rawTokenAmount?.mint === tokenMint
        );

        // Also check innerSwaps if they exist
        if (swap.innerSwaps && Array.isArray(swap.innerSwaps)) {
            for (const innerSwap of swap.innerSwaps) {
                const innerInputs = innerSwap.tokenInputs || [];
                const innerOutputs = innerSwap.tokenOutputs || [];
                
                const hasInnerTokenInput = innerInputs.some((input: any) => input?.mint === tokenMint);
                const hasInnerTokenOutput = innerOutputs.some((output: any) => output?.mint === tokenMint);
                
                if (hasInnerTokenInput || hasInnerTokenOutput) {
                    return true;
                }
            }
        }

        return hasTokenInput || hasTokenOutput;
    }

    static parseSwapDetails(swap: any) {
        try {
            // Try to parse from top-level tokenInputs/tokenOutputs first
            let result = this.parseTopLevelSwap(swap);
            if (result) return result;

            // Fall back to innerSwaps
            if (swap.innerSwaps && Array.isArray(swap.innerSwaps)) {
                for (const innerSwap of swap.innerSwaps) {
                    result = this.parseInnerSwap(innerSwap);
                    if (result) return result;
                }
            }

            logger.debug('Could not parse swap details:' + JSON.stringify ({
                hasTokenInputs: !!swap.tokenInputs?.length,
                hasTokenOutputs: !!swap.tokenOutputs?.length,
                hasInnerSwaps: !!swap.innerSwaps?.length,
            }, null, 2));

            return null;
        } catch (error: any) {
            logger.error('Error parsing swap details:', error);
            return null;
        }
    }

    static parseTopLevelSwap(swap: any) {
        const tokenInputs = swap.tokenInputs || [];
        const tokenOutputs = swap.tokenOutputs || [];

        const tokenOutput = tokenOutputs.find((o: any) => o?.mint === config.token.mintAddress);
        const tokenInput = tokenInputs.find((i: any) => i?.mint === config.token.mintAddress);

        const baseInput = tokenInputs.find((i: any) =>
            [WSOL_MINT, USDC_MINT, USDT_MINT].includes(i?.mint)
        );
        const baseOutput = tokenOutputs.find((o: any) =>
            [WSOL_MINT, USDC_MINT, USDT_MINT].includes(o?.mint)
        );

        return this.calculateSwapAmounts(tokenOutput, tokenInput, baseInput, baseOutput);
    }

    static parseInnerSwap(innerSwap: any) {
        const tokenInputs = innerSwap.tokenInputs || [];
        const tokenOutputs = innerSwap.tokenOutputs || [];

        const tokenOutput = tokenOutputs.find((o: any) => o?.mint === config.token.mintAddress);
        const tokenInput = tokenInputs.find((i: any) => i?.mint === config.token.mintAddress);

        const baseInput = tokenInputs.find((i: any) =>
            [WSOL_MINT, USDC_MINT, USDT_MINT].includes(i?.mint)
        );
        const baseOutput = tokenOutputs.find((o: any) =>
            [WSOL_MINT, USDC_MINT, USDT_MINT].includes(o?.mint)
        );

        return this.calculateSwapAmounts(tokenOutput, tokenInput, baseInput, baseOutput);
    }

    static calculateSwapAmounts(tokenOutput: any, tokenInput: any, baseInput: any, baseOutput: any) {
        let amountSol = 0;
        let tokens = 0;
        let type: 'BUY' | 'SELL' | 'UNKNOWN' = 'UNKNOWN';

        if (tokenOutput && baseInput) {
            // BUY: Base asset -> Token
            if (baseInput.mint === WSOL_MINT) {
                amountSol = baseInput.tokenAmount || 0;
            } else {
                amountSol = baseInput.tokenAmount || 0; // USDC/USDT (already in decimal format from Helius)
            }

            // Get token amount - try different possible fields
            tokens = tokenOutput.tokenAmount || 
                    (tokenOutput.rawTokenAmount?.tokenAmount ? 
                        Number(tokenOutput.rawTokenAmount.tokenAmount) / Math.pow(10, config.token.decimals) : 0);

            type = 'BUY';
        } else if (tokenInput && baseOutput) {
            // SELL: Token -> Base asset
            if (baseOutput.mint === WSOL_MINT) {
                amountSol = baseOutput.tokenAmount || 0;
            } else {
                amountSol = baseOutput.tokenAmount || 0;
            }

            tokens = tokenInput.tokenAmount || 
                    (tokenInput.rawTokenAmount?.tokenAmount ? 
                        Number(tokenInput.rawTokenAmount.tokenAmount) / Math.pow(10, config.token.decimals) : 0);

            type = 'SELL';
        } else {
            return null;
        }

        const pricePerToken = tokens > 0 ? amountSol / tokens : 0;

        return {
            amountSol,
            tokens,
            type,
            pricePerToken
        };
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