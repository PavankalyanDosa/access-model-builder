import { logger } from '@sailpoint/connector-sdk'
import { SailPointApiService } from './sailpoint-api.service'
import { ConnectorConfig, EntitlementData, TargetSource, WorkflowInput } from '../models/types'
import { retryWithBackoff } from '../utils/retry.util'

/**
 * Service for handling entitlement synchronization logic
 */
import { RoleManagementService } from './role-management.service'

export class EntitlementSyncService {
    private client: SailPointApiService
    private config: ConnectorConfig
    private roleService: RoleManagementService

    constructor(client: SailPointApiService, config: ConnectorConfig) {
        this.client = client
        this.config = config
        this.roleService = new RoleManagementService(client)
    }

    /**
     * Stream entitlements page by page using an Async Generator
     * Yields entitlements one by one to the caller (presentation layer)
     * Handles pagination, execution limits, and syncing to targets internally
     */
    async *streamEntitlements(): AsyncGenerator<EntitlementData, void, unknown> {
        logger.info('Starting entitlement stream...')
        let globalYielded = 0 // For serial mode (global counter)
        const executionLimit = this.config.executionLimit || 0
        const isParallel = this.config.processingType === 'parallel'

        logger.info(`Processing Type: ${isParallel ? 'Parallel (per-source limit)' : 'Serial (global limit)'}`)
        if (executionLimit > 0) {
            logger.info(`Execution Limit: ${executionLimit} ${isParallel ? 'per source' : 'total'}`)
        }

        // Pre-resolve target source IDs to avoid repeated API calls
        const targetSourceIds = await this.resolveTargetSourceIds()

        for (const sourceConfig of this.config.entitlementSources) {
            let sourceYielded = 0 // For parallel mode (per-source counter)
            const sourceName = sourceConfig.sourceName
            const types = Array.isArray(sourceConfig.entitlementTypes) ? sourceConfig.entitlementTypes : []

            if (!sourceName) continue

            const sourceId = await this.client.resolveSourceIdByName(sourceName)
            if (!sourceId) {
                logger.error(`Could not resolve Source ID for name: ${sourceName}`)
                continue
            }

            logger.info(`Streaming entitlements from source: ${sourceName}`)

            // Build filter
            let filter = `source.id eq "${sourceId}"`
            if (types.length > 0) {
                const typeFilters = types.map((t: string) => `attribute eq "${t}"`).join(' or ')
                filter += ` and (${typeFilters})`
            }

            // Fetch first page to get total count
            const firstPage = await this.client.fetchEntitlementsPage(filter, 0, 250)
            const totalCount = firstPage.totalCount
            logger.info(`Source ${sourceName} has ${totalCount} total entitlements matching filter`)

            let offset = 0
            let pageNumber = 1
            const pageSize = 250

            while (offset < totalCount) {
                // Check execution limit based on mode
                if (executionLimit > 0) {
                    if (isParallel && sourceYielded >= executionLimit) {
                        logger.info(
                            `Source ${sourceName}: Execution limit of ${executionLimit} reached. Moving to next source.`
                        )
                        break // Stop this source, continue to next
                    } else if (!isParallel && globalYielded >= executionLimit) {
                        logger.info(`Global execution limit of ${executionLimit} reached. Stopping stream.`)
                        return // Stop all processing
                    }
                }

                // Fetch current page (reuse first page data for page 1)
                const page =
                    pageNumber === 1 ? firstPage : await this.client.fetchEntitlementsPage(filter, offset, pageSize)
                logger.info(
                    `Processing page ${pageNumber} from ${sourceName} (${page.entitlements.length} entitlements)`
                )

                // Process entitlements one by one
                for (const ent of page.entitlements) {
                    // Check limit again within page
                    if (executionLimit > 0) {
                        if (isParallel && sourceYielded >= executionLimit) {
                            logger.info(
                                `Source ${sourceName}: Execution limit of ${executionLimit} reached during page yield. Moving to next source.`
                            )
                            break
                        } else if (!isParallel && globalYielded >= executionLimit) {
                            logger.info(
                                `Global execution limit of ${executionLimit} reached during page yield. Stopping.`
                            )
                            return
                        }
                    }

                    // 1. Yield entitlement to the caller (Presentation Layer)
                    yield ent
                    sourceYielded++
                    globalYielded++

                    // 2. Sync this single entitlement to target sources (Business Logic)
                    // This is now interleaved with yielding, ensuring control returns to index.ts frequently
                    await this.syncEntitlementToTargets(ent, targetSourceIds)

                    // Ensure Role or Access Profile exists if configured (per-source)
                    if (sourceConfig.roleNameTemplate || sourceConfig.accessProfileCreation) {
                        await this.roleService.ensureRoleExists(
                            ent,
                            sourceName,
                            sourceConfig,
                            this.config.targetSources
                        )
                    }
                }

                // Move to next page
                offset += pageSize
                pageNumber++
            }

            logger.info(`Completed streaming source ${sourceName}`)
        }

        logger.info(`Total entitlements streamed: ${globalYielded}`)
    }

    /**
     * Resolve all target source IDs upfront
     */
    private async resolveTargetSourceIds(): Promise<Map<string, string>> {
        const sourceIds = new Map<string, string>()

        for (const targetSource of this.config.targetSources) {
            const name = targetSource.sourceName
            if (!name) continue

            const id = await this.client.resolveSourceIdByName(name)
            if (id) {
                sourceIds.set(name, id)
            } else {
                logger.error(`Could not resolve Target Source ID for name: ${name}`)
            }
        }

        return sourceIds
    }

    /**
     * Sync a single entitlement to all target sources
     */
    private async syncEntitlementToTargets(ent: EntitlementData, targetSourceIds: Map<string, string>): Promise<void> {
        if (!ent.value) return

        for (const targetSource of this.config.targetSources) {
            const targetSourceName = targetSource.sourceName
            if (!targetSourceName) continue

            const targetSourceId = targetSourceIds.get(targetSourceName)
            if (!targetSourceId) continue

            // Add throttling delay to prevent rate limiting (100ms between requests)
            await new Promise((resolve) => setTimeout(resolve, 100))

            // Check if entitlement exists with retry logic
            const exists = await retryWithBackoff(
                () =>
                    this.client.checkEntitlementExists(
                        targetSourceName,
                        ent.attribute || 'group',
                        ent.value || ent.name
                    ),
                3,
                `entitlement ${ent.value}`
            )

            if (exists === null) {
                logger.error(`Failed to check entitlement ${ent.value} after retries, skipping`)
                continue
            }

            // If entitlement doesn't exist, launch workflow
            if (!exists) {
                logger.info(
                    `Entitlement ${ent.value} missing in Target Source ${targetSourceName}. Launching Workflow...`
                )
                await this.launchWorkflow(ent, targetSource, targetSourceId)
            } else {
                logger.info(`Entitlement ${ent.value} already exists in Target Source ${targetSourceName}`)
            }
        }
    }

    /**
     * Launch workflow for a missing entitlement
     */
    private async launchWorkflow(
        entitlement: EntitlementData,
        targetSourceConfig: TargetSource,
        targetSourceId: string
    ): Promise<void> {
        // Determine which workflow credentials to use
        let workflowId = this.config.workflowId
        let clientId = this.config.workflowClientId
        let clientSecret = this.config.workflowClientSecret

        // If target source has standard=true, use its specific workflow config
        if (targetSourceConfig.standard === true) {
            workflowId = targetSourceConfig.workflowId!
            clientId = targetSourceConfig.workflowClientId!
            clientSecret = targetSourceConfig.workflowClientSecret!

            logger.info(`Using Standard workflow for target source ${targetSourceConfig.sourceName}`)
        } else {
            logger.info(`Using Global workflow for target source ${targetSourceConfig.sourceName}`)
        }

        if (!workflowId || !clientId || !clientSecret) {
            logger.error(
                `Missing workflow configuration for target source ${targetSourceConfig.sourceName} (Standard: ${targetSourceConfig.standard})`
            )
            return
        }

        // Prepare workflow input
        const input: WorkflowInput = {
            displayName: entitlement.displayName || entitlement.name,
            value: entitlement.value!,
            type: entitlement.attribute || entitlement.type || 'unknown',
            description: entitlement.description,
            attributes: entitlement.attributes,
            targetSourceId: targetSourceId,
        }

        try {
            await this.client.executeWorkflow(workflowId, input, clientId, clientSecret, this.config.baseurl)
            logger.info(`Workflow ${workflowId} triggered successfully for entitlement ${entitlement.value}`)
        } catch (error: any) {
            logger.error(`Failed to trigger workflow ${workflowId}: ${error.message}`)
            if (error.response) {
                logger.error(`Response status: ${error.response.status}`)
                logger.error(`Response data: ${JSON.stringify(error.response.data)}`)
            }
        }
    }
}
