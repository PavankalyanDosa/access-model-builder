import { ConnectorConfig } from './types'
import { logger } from '@sailpoint/connector-sdk'

export class Config {
    private config: ConnectorConfig

    constructor(config: ConnectorConfig) {
        this.config = config
    }

    /**
     * Print the configuration
     */
    print(): void {
        logger.info('Connector Configuration:')
        logger.info(JSON.stringify(this.config, null, 2))
    }
}
