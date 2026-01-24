import { AutoTokenizer } from "@huggingface/transformers";

// Initialize tokenizer (singleton pattern for performance)
let tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;

async function getTokenizer() {
    if (!tokenizer) {
        tokenizer = await AutoTokenizer.from_pretrained('Xenova/bert-base-uncased');
    }
    return tokenizer;
}

/**
 * Count tokens in a string using the BERT tokenizer
 */
export async function countTokens(text: string): Promise<number> {
    const tok = await getTokenizer();
    const { input_ids } = await tok(text);
    return input_ids.size;
}

/**
 * Synchronous approximation for tokens (fallback)
 * Uses the same 1/4 character ratio as before
 */
export function countTokensSync(text: string): number {
    return Math.ceil(text.length / 4);
}