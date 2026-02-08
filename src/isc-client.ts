import { ConnectorError, logger } from '@sailpoint/connector-sdk'
import { SailPointApiService } from './services/sailpoint-api.service'
import { EntitlementSyncService } from './services/entitlement-synchronizer.service'
import { ConnectorConfig, EntitlementData } from './models/types'

/**
 * Main client for ISC connector operations
 * Acts as a facade/controller for the various services
 */
export class IscClient {
    private apiService: SailPointApiService
    private syncService: EntitlementSyncService
    private config: ConnectorConfig

    constructor(config: any) {
        // Validate required config
        if (!config.baseurl) {
            throw new ConnectorError('baseurl is required')
        }

        // Store config
        this.config = {
            baseurl: config.baseurl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            dryRun: config.dryRun || false,
            // If dry run is false, force executionLimit to 0 (unlimited) and processingType to 'serial'
            executionLimit: config.dryRun ? config.executionLimit || 0 : 0,
            processingType: config.dryRun ? config.processingType || 'serial' : 'serial',

            workflowId: config.workflowId,
            workflowClientId: config.workflowClientId,
            workflowClientSecret: config.workflowClientSecret,
            entitlementSources: config.entitlementSources || [],
            targetSources: config.targetSources || [],
        }

        // Initialize services
        this.apiService = new SailPointApiService(this.config.baseurl, this.config.clientId, this.config.clientSecret)

        this.syncService = new EntitlementSyncService(this.apiService, this.config)
    }

    /**
     * Test connection to SailPoint ISC
     */
    async testConnection(): Promise<any> {
        try {
            await this.apiService.testConnection()
            logger.info('Connection test successful')
            return {}
        } catch (error: any) {
            logger.error(`Connection test failed: ${error.message}`)
            throw new ConnectorError(`Connection test failed: ${error.message}`)
        }
    }

    /**
     * Stream entitlements page by page
     * This allows the presentation layer to handle responses and keep-alive
     * while the service layer handles pagination and syncing
     */
    async *streamEntitlements(): AsyncGenerator<EntitlementData, void, unknown> {
        // Delegate to the sync service generator
        for await (const ent of this.syncService.streamEntitlements()) {
            yield ent
        }
    }
}
