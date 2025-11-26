import { logger } from '@sailpoint/connector-sdk'

/**
 * Retry a function with exponential backoff on rate limit errors
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    context: string = 'operation'
): Promise<T | null> {
    let retryCount = 0

    while (retryCount <= maxRetries) {
        try {
            return await fn()
        } catch (error: any) {
            // Check if it's a rate limit error (429)
            if (error.response && error.response.status === 429) {
                retryCount++
                if (retryCount <= maxRetries) {
                    // Exponential backoff: 2^retryCount seconds
                    const waitTime = Math.pow(2, retryCount) * 1000
                    logger.warn(`Rate limit hit for ${context}. Retry ${retryCount}/${maxRetries} after ${waitTime}ms`)

                    // Wait before retrying
                    await new Promise((resolve) => setTimeout(resolve, waitTime))
                } else {
                    logger.error(`Max retries reached for ${context} due to rate limiting`)
                    return null
                }
            } else {
                // Non-rate-limit error, throw it
                throw error
            }
        }
    }

    return null
}
