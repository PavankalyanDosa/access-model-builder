import { EntitlementData, EntitlementSource, TargetSource } from '../models/types'
import { SailPointApiService } from './sailpoint-api.service'
import { logger } from '@sailpoint/connector-sdk'
import * as Velocity from 'velocityjs'
import {
    RequestabilityForRoleV2025,
    RevocabilityForRoleV2025,
    OwnerReferenceV2025,
    RoleV2025,
    ApprovalSchemeForRoleV2025ApproverTypeV2025,
    RoleMembershipSelectorV2025,
    AttributeDTOV2025,
    AttributeValueDTOV2025,
} from 'sailpoint-api-client/dist/v2025'
import { stringToMembership, Source } from '../utils/membership-parser'

export class RoleManagementService {
    private client: SailPointApiService
    private metadataChecked = false
    private cachePrewarmed = false

    // Caches
    private governanceGroupCache = new Map<string, string>() // Name -> ID
    private segmentCache = new Map<string, string>() // Name -> ID
    private sourceOwnerCache = new Map<string, string>() // Source Name -> Owner ID
    private userCache = new Map<string, string>() // Name/Alias -> ID

    constructor(client: SailPointApiService) {
        this.client = client
    }

    /**
     * Prewarm caches by batch fetching all governance groups and segments
     * This eliminates N+1 query patterns
     */
    public async prewarmCaches(configs: EntitlementSource[]): Promise<void> {
        if (this.cachePrewarmed) return
        
        logger.info('Prewarming caches for governance groups and segments...')
        
        // Collect all unique names
        const govGroupNames = new Set<string>()
        const segmentNames = new Set<string>()
        
        for (const config of configs) {
            if (Array.isArray(config.roleGovernanceGroupNames)) {
                config.roleGovernanceGroupNames.forEach(name => govGroupNames.add(name))
            }
            if (Array.isArray(config.roleRevocationGovernanceGroupNames)) {
                config.roleRevocationGovernanceGroupNames.forEach(name => govGroupNames.add(name))
            }
            if (Array.isArray(config.roleSegmentNames)) {
                config.roleSegmentNames.forEach(name => segmentNames.add(name))
            }
        }
        
        // Helper for chunked execution to avoid rate limits
        const processInChunks = async (items: string[], processor: (item: string) => Promise<void>, chunkSize: number) => {
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize)
                await Promise.all(chunk.map(processor))
            }
        }

        // Batch fetch governance groups (Chunk size 5)
        if (govGroupNames.size > 0) {
            logger.info(`Fetching ${govGroupNames.size} governance groups...`)
            await processInChunks(Array.from(govGroupNames), async (name) => {
                const id = await this.client.getGovernanceGroupId(name)
                if (id) {
                    this.governanceGroupCache.set(name, id)
                } else {
                    logger.warn(`Could not find Governance Group: ${name}`)
                    this.governanceGroupCache.set(name, 'NOT_FOUND') // Negative caching
                }
            }, 5)
        }
        
        // Batch fetch segments (Chunk size 5)
        if (segmentNames.size > 0) {
            logger.info(`Fetching ${segmentNames.size} segments...`)
            await processInChunks(Array.from(segmentNames), async (name) => {
                const id = await this.client.searchSegment(name)
                if (id) {
                    this.segmentCache.set(name, id)
                } else {
                    logger.warn(`Could not find Segment: ${name}`)
                    this.segmentCache.set(name, 'NOT_FOUND') // Negative caching
                }
            }, 5)
        }
        
        this.cachePrewarmed = true
        const govGroupSuccess = Array.from(this.governanceGroupCache.values()).filter(v => v !== 'NOT_FOUND').length
        const segmentSuccess = Array.from(this.segmentCache.values()).filter(v => v !== 'NOT_FOUND').length
        logger.info(`Cache prewarming complete. Loaded ${govGroupSuccess}/${this.governanceGroupCache.size} governance groups and ${segmentSuccess}/${this.segmentCache.size} segments.`)
    }

    /**
     * Ensure an Access Profile exists for the given entitlement
     * Only creates AP if the entitlement exists in the target source
     */
    async ensureAccessProfileExists(
        entitlement: EntitlementData,
        sourceName: string,
        config: EntitlementSource
    ): Promise<string | undefined> {
        if (!config.accessProfileCreation || !config.accessProfileNameTemplate) {
            return undefined
        }

        try {
            // CRITICAL: Verify entitlement exists in target source before creating Access Profile
            logger.info(`Verifying entitlement ${entitlement.name} exists in target source ${sourceName}...`)
            const targetExists = await this.client.checkEntitlementExists(
                sourceName,
                entitlement.attribute || 'group',
                entitlement.value || entitlement.name
            )

            if (!targetExists) {
                logger.warn(
                    `Entitlement ${entitlement.name} does NOT exist in target source ${sourceName}. Skipping Access Profile creation.`
                )
                return undefined
            }

            logger.info(`Entitlement ${entitlement.name} confirmed in target source ${sourceName}. Proceeding with Access Profile.`)

            const apName = this.renderTemplate(config.accessProfileNameTemplate!, entitlement, sourceName)
            const apDescription = `Access Profile created for entitlement ${
                entitlement.displayName || entitlement.name
            } from source ${sourceName}`

            logger.info(`Checking existence of Access Profile: ${apName}`)

            const existingAp = await this.client.searchAccessProfile(apName)
            
            // Resolve Access Profile Owner (using AP-specific config or fallback to role config)
            const ownerType = config.accessProfileOwnerType || config.roleOwnerType
            const ownerName = config.accessProfileOwnerName || config.roleOwnerName
            const ownerId = (await this.resolveAccessProfileOwner(ownerType, ownerName, sourceName))?.id
            
            // Resolve Source ID for the entitlement
            const sourceId = await this.client.resolveSourceIdByName(sourceName)
            if (!sourceId) {
                logger.error(`Could not resolve source ID for ${sourceName}. Skipping Access Profile creation.`)
                return undefined
            }

            const entitlementRef = {
                type: 'ENTITLEMENT',
                id: entitlement.id,
                name: entitlement.name || entitlement.value,
            }

            if (existingAp) {
                logger.info(`Access Profile ${apName} exists (ID: ${existingAp.id}). Checking for updates...`)
                const operations: any[] = []

                if (existingAp.description !== apDescription) {
                    operations.push({ op: 'replace', path: '/description', value: apDescription })
                }
                
                if (ownerId && existingAp.owner?.id !== ownerId) {
                    operations.push({ op: 'replace', path: '/owner', value: { type: 'IDENTITY', id: ownerId } })
                }

                // Ensure entitlement is present
                const currentEntitlements = existingAp.entitlements || []
                const entExists = currentEntitlements.some((e: any) => e.id === entitlement.id)
                if (!entExists) {
                    const updatedEntitlements = [...currentEntitlements, entitlementRef as any]
                    operations.push({ op: 'replace', path: '/entitlements', value: updatedEntitlements })
                }

                if (operations.length > 0) {
                    await this.client.updateAccessProfile(existingAp.id!, operations)
                    logger.info(`Successfully updated Access Profile: ${apName}`)
                } else {
                    logger.info(`Access Profile ${apName} is up to date.`)
                }
                return existingAp.id
            } else {
                logger.info(`Access Profile ${apName} does not exist. Creating...`)
                const newAp = await this.client.createAccessProfile({
                    name: apName,
                    description: apDescription,
                    enabled: config.accessProfileEnabled ?? true, // Default true (must be enabled to use in Roles)
                    owner: ownerId ? { type: 'IDENTITY', id: ownerId } : undefined,
                    source: { id: sourceId, type: 'SOURCE', name: sourceName },
                    entitlements: [entitlementRef],
                    requestable: config.accessProfileRequestable ?? false, // Default false when used in Roles
                } as any)
                logger.info(`Successfully created Access Profile: ${apName}`)
                return newAp?.id
            }
        } catch (error: any) {
            logger.error(`Failed to ensure Access Profile exists for ${entitlement.name}: ${error.message}`)
            return undefined
        }
    }

    /**
     * Ensure a Role exists for the given entitlement
     * Checks if Role exists, if not creates it. If exists, updates it if needed.
     */
    async ensureRoleExists(
        entitlement: EntitlementData,
        sourceName: string,
        config: EntitlementSource,
        allTargetSources: TargetSource[]
    ): Promise<void> {
        // Skip if neither Role nor Access Profile creation is configured
        if (!config.roleNameTemplate && !config.accessProfileNameTemplate) {
            return
        }

        // Ensure metadata attribute exists (once per execution)
        if (!this.metadataChecked) {
            await this.client.ensureRoleMetadataAttributeExists()
            this.metadataChecked = true
        }

        // 1. Ensure Access Profile Exists (if configured)
        let accessProfileId: string | undefined
        if (config.accessProfileNameTemplate) {
            accessProfileId = await this.ensureAccessProfileExists(entitlement, sourceName, config)
        }

        // 2. Ensure Role Exists (if configured)
        if (!config.roleNameTemplate) {
            return
        }

        try {
            // "All" Creation Logic: Check if entitlement exists in ALL target sources
            if (config.roleCreationStyle === 'all' && allTargetSources && allTargetSources.length > 0) {
                logger.info(
                    `Role Creation Style is 'all'. Verifying entitlement existence in all ${allTargetSources.length} target sources...`
                )

                // Filter out the current source (it already exists there)
                const otherSources = allTargetSources.filter((s) => s.sourceName !== sourceName)

                for (const target of otherSources) {
                    const exists = await this.client.checkEntitlementExists(
                        target.sourceName,
                        entitlement.attribute || 'group',
                        entitlement.value || entitlement.name
                    )
                    if (!exists) {
                        logger.info(
                            `Entitlement ${entitlement.name} does NOT exist in target source ${target.sourceName}. Skipping Role creation.`
                        )
                        return
                    }
                }
                logger.info(
                    `Entitlement ${entitlement.name} exists in all target sources. Proceeding with Role creation.`
                )
            }

            let roleName = this.renderTemplate(config.roleNameTemplate!, entitlement, sourceName)
            let roleDescription = config.roleDescriptionTemplate
                ? this.renderTemplate(config.roleDescriptionTemplate, entitlement, sourceName)
                : `Role created for entitlement ${
                      entitlement.displayName || entitlement.name
                  } from source ${sourceName}`

            // Apply Case Transformation
            if (config.roleNameCase === 'upper') {
                roleName = roleName.toUpperCase()
            } else if (config.roleNameCase === 'lower') {
                roleName = roleName.toLowerCase()
            }

            if (config.roleDescriptionCase === 'upper') {
                roleDescription = roleDescription.toUpperCase()
            } else if (config.roleDescriptionCase === 'lower') {
                roleDescription = roleDescription.toLowerCase()
            }

            logger.info(`Checking existence of Role: ${roleName}`)

            // Check if role exists
            const existingRole = await this.client.searchRole(roleName)

            // Resolve Owner
            const ownerId = (await this.resolveOwner(config, sourceName))?.id

            // Resolve Approvers
            const accessRequestConfig = await this.resolveAccessRequestConfig(config, sourceName)

            // Resolve Revocation Approvers
            const revocationRequestConfig = await this.resolveRevocationRequestConfig(config, sourceName)

            // Resolve Segments
            const segmentIds = await this.resolveSegments(config)

            // Role Assignment Definition (Membership Criteria)
            let membership: RoleMembershipSelectorV2025 | undefined = undefined
            if (config.roleMembershipCriteria) {
                try {
                    // Render Velocity template for membership criteria
                    const renderedCriteria = this.renderTemplate(config.roleMembershipCriteria, entitlement, sourceName)
                    logger.debug(`Rendered membership criteria: ${renderedCriteria}`)

                    // Get all sources for the parser
                    const sources = await this.getAllSources()
                    
                    // Parse using proven reference implementation
                    membership = await stringToMembership(renderedCriteria, sources)
                } catch (error: any) {
                    logger.error(`Failed to parse membership criteria: ${error.message}`)
                    logger.warn(`Role ${roleName} will be created without automatic assignment.`)
                }
            }

            if (existingRole) {
                logger.info(`Role ${roleName} exists (ID: ${existingRole.id}). Checking for updates...`)

                // Fetch full role details to check attributes
                const fullRole = await this.client.getRole(existingRole.id)

                if (!fullRole) {
                    logger.warn(`Could not fetch full details for role ${roleName}. Skipping updates.`)
                    return
                }

                // Check for manual override
                // Use accessModelMetadata to check for roleManualOverride
                const metadata = fullRole.accessModelMetadata?.attributes
                const manualOverrideAttr = metadata?.find((attr: AttributeDTOV2025) => attr.key === 'roleManualOverride')
                const isManualOverride = manualOverrideAttr?.values?.some((val: AttributeValueDTOV2025) => val.value === 'true')

                if (isManualOverride) {
                    logger.info(`Role ${roleName} has 'roleManualOverride' set to true. Skipping updates.`)
                    return
                }

                // Prepare updates
                const operations: any[] = []

                if (fullRole.description !== roleDescription) {
                    operations.push({ op: 'replace', path: '/description', value: roleDescription })
                }

                if (config.roleEnabled !== undefined && fullRole.enabled !== config.roleEnabled) {
                    operations.push({ op: 'replace', path: '/enabled', value: config.roleEnabled })
                }

                if (config.roleRequestable !== undefined && fullRole.requestable !== config.roleRequestable) {
                    operations.push({ op: 'replace', path: '/requestable', value: config.roleRequestable })
                }

                if (ownerId && fullRole.owner?.id !== ownerId) {
                    operations.push({ op: 'replace', path: '/owner', value: { type: 'IDENTITY', id: ownerId } })
                }

                // Update Access Request Config (Approvers & Comments)
                if (
                    (accessRequestConfig.approvalSchemes && accessRequestConfig.approvalSchemes.length > 0) ||
                    config.roleAccessRequestCommentsRequired !== undefined ||
                    config.roleAccessRequestDenialCommentsRequired !== undefined
                ) {
                    const newAccessRequestConfig = {
                        ...fullRole.accessRequestConfig, // Keep existing fields we don't manage
                        approvalSchemes: accessRequestConfig.approvalSchemes,
                        commentsRequired: accessRequestConfig.commentsRequired,
                        denialCommentsRequired: accessRequestConfig.denialCommentsRequired,
                    }

                    if (JSON.stringify(fullRole.accessRequestConfig) !== JSON.stringify(newAccessRequestConfig)) {
                        operations.push({ op: 'replace', path: '/accessRequestConfig', value: newAccessRequestConfig })
                    }
                }

                // Update Revocation Request Config
                if (revocationRequestConfig.approvalSchemes && revocationRequestConfig.approvalSchemes.length > 0) {
                    const newRevocationRequestConfig = {
                        ...fullRole.revocationRequestConfig,
                        approvalSchemes: revocationRequestConfig.approvalSchemes,
                    }

                    if (
                        JSON.stringify(fullRole.revocationRequestConfig) !== JSON.stringify(newRevocationRequestConfig)
                    ) {
                        operations.push({
                            op: 'replace',
                            path: '/revocationRequestConfig',
                            value: newRevocationRequestConfig,
                        })
                    }
                }

                // Update Segments
                if (segmentIds.length > 0) {
                    operations.push({ op: 'replace', path: '/segments', value: segmentIds })
                }

                // Update Membership (Role Assignment Definition)
                // Always update membership to clear any invalid old criteria
                if (config.roleMembershipCriteria && membership) {
                    // We have new criteria, replace it
                    operations.push({ op: 'replace', path: '/membership', value: membership })
                } else if (fullRole.membership && fullRole.membership.criteria) {
                    // Role has existing criteria but we don't have new ones, clear it
                    operations.push({ op: 'replace', path: '/membership', value: { type: 'STANDARD' } })
                }

                // Update Entitlements OR Access Profiles
                if (accessProfileId) {
                    // If we have an Access Profile, ensure it's linked
                    const currentAPs = fullRole.accessProfiles || []
                    const apExists = currentAPs.some((ap: any) => ap.id === accessProfileId)
                    
                    if (!apExists) {
                        const updatedAPs = [
                            ...currentAPs,
                            {
                                type: 'ACCESS_PROFILE',
                                id: accessProfileId,
                                name: roleName || 'Access Profile', // We might need to pass apName from ensureAccessProfileExists
                            },
                        ]
                        operations.push({ op: 'replace', path: '/accessProfiles', value: updatedAPs })
                        logger.info(`Adding Access Profile ${accessProfileId} to role ${roleName}`)
                    }
                    
                    // Should we remove direct entitlement assignment if we switch to AP?
                    // For safety, let's leave existing entitlements but prefer AP for new ones.
                    // Or, if we are strictly using APs now, maybe we should clean up?
                    // Let's keep it additive for now to avoid breaking changes.
                } else {
                    // Fallback to direct Entitlement assignment
                    const currentEntitlements = fullRole.entitlements || []
                    const entitlementExists = currentEntitlements.some((ent: any) => ent.id === entitlement.id)

                    if (!entitlementExists) {
                        const updatedEntitlements = [
                            ...currentEntitlements,
                            {
                                type: 'ENTITLEMENT',
                                id: entitlement.id,
                                name: entitlement.name || entitlement.value,
                            },
                        ]
                        operations.push({ op: 'replace', path: '/entitlements', value: updatedEntitlements })
                        logger.info(`Adding entitlement ${entitlement.name} to role ${roleName}`)
                    }
                }

                if (operations.length > 0) {
                    logger.info(`Updating Role ${roleName} with ${operations.length} changes...`)
                    await this.client.updateRole(existingRole.id, operations)
                    logger.info(`Successfully updated Role: ${roleName}`)
                } else {
                    logger.info(`Role ${roleName} is up to date.`)
                }

                return
            }

            logger.info(`Role ${roleName} does not exist. Creating...`)

            // Prepare entitlement reference or Access Profile reference
            let entitlementsList: any[] = []
            let accessProfilesList: any[] = []

            if (accessProfileId) {
                accessProfilesList.push({
                    id: accessProfileId,
                    type: 'ACCESS_PROFILE',
                    name: roleName, // Placeholder, ID is what matters
                })
            } else {
                entitlementsList.push({
                    id: entitlement.id,
                    name: entitlement.name || entitlement.value,
                    type: 'ENTITLEMENT'
                })
            }

            // Create Role
            const newRole = await this.client.createRole({
                name: roleName,
                description: roleDescription,
                enabled: config.roleEnabled ?? false,
                requestable: config.roleRequestable ?? false,
                ownerId: ownerId,
                accessRequestConfig: accessRequestConfig,
                revocationRequestConfig: revocationRequestConfig,
                segments: segmentIds,
                membership: membership,
                entitlements: entitlementsList as any,
                accessProfiles: accessProfilesList as any,
            } as any)

            // Explicitly associate metadata value using the requested API endpoint
            if (newRole && newRole.id) {
                await this.client.addRoleMetadata(newRole.id, 'roleManualOverride', 'false')
            }

            logger.info(`Successfully created Role: ${roleName}`)
        } catch (error) {
            logger.error(`Failed to ensure role exists for entitlement ${entitlement.name}: ${error}`)
        }
    }

    /**
     * Resolve Role Owner with caching
     */
    private async resolveOwner(config: EntitlementSource, sourceName: string): Promise<OwnerReferenceV2025 | null> {
        let ownerId: string | undefined

        if (config.roleOwnerType === 'sourceOwner') {
            if (this.sourceOwnerCache.has(sourceName)) {
                ownerId = this.sourceOwnerCache.get(sourceName)
            } else {
                const sourceId = await this.client.resolveSourceIdByName(sourceName)
                if (sourceId) {
                    const sourceOwnerId = await this.client.getSourceOwner(sourceId)
                    if (sourceOwnerId) {
                        ownerId = sourceOwnerId
                        this.sourceOwnerCache.set(sourceName, ownerId)
                    }
                }
            }

            if (!ownerId) {
                logger.warn(`Could not find owner for source ${sourceName}.`)
            }
        } else if (config.roleOwnerType === 'individual' && config.roleOwnerName) {
            if (this.userCache.has(config.roleOwnerName)) {
                ownerId = this.userCache.get(config.roleOwnerName)
            } else {
                const id = await this.client.getUserId(config.roleOwnerName)
                if (id) {
                    ownerId = id
                    this.userCache.set(config.roleOwnerName, ownerId)
                }
            }

            if (!ownerId) {
                logger.warn(`Could not find user ${config.roleOwnerName}.`)
            }
        }

        return ownerId ? { type: 'IDENTITY', id: ownerId } : null
    }

    /**
     * Resolve Access Profile Owner (separate from Role Owner)
     */
    private async resolveAccessProfileOwner(
        ownerType?: string,
        ownerName?: string,
        sourceName?: string
    ): Promise<OwnerReferenceV2025 | null> {
        let ownerId: string | undefined

        if (ownerType === 'sourceOwner' && sourceName) {
            if (this.sourceOwnerCache.has(sourceName)) {
                ownerId = this.sourceOwnerCache.get(sourceName)
            } else {
                const sourceId = await this.client.resolveSourceIdByName(sourceName)
                if (sourceId) {
                    const sourceOwnerId = await this.client.getSourceOwner(sourceId)
                    if (sourceOwnerId) {
                        ownerId = sourceOwnerId
                        this.sourceOwnerCache.set(sourceName, ownerId)
                    }
                }
            }

            if (!ownerId) {
                logger.warn(`Could not find owner for source ${sourceName}.`)
            }
        } else if (ownerType === 'individual' && ownerName) {
            if (this.userCache.has(ownerName)) {
                ownerId = this.userCache.get(ownerName)
            } else {
                const id = await this.client.getUserId(ownerName)
                if (id) {
                    ownerId = id
                    this.userCache.set(ownerName, ownerId)
                }
            }

            if (!ownerId) {
                logger.warn(`Could not find user with name ${ownerName}.`)
            }
        }

        return ownerId ? { type: 'IDENTITY', id: ownerId } : null
    }

    /**
     * Resolve Access Request Config with caching
     */
    private async resolveAccessRequestConfig(
        config: EntitlementSource,
        sourceName: string
    ): Promise<RequestabilityForRoleV2025> {
        const accessRequestConfig: RequestabilityForRoleV2025 = {
            approvalSchemes: [],
            commentsRequired: config.roleAccessRequestCommentsRequired || false,
            denialCommentsRequired: config.roleAccessRequestDenialCommentsRequired || false,
        }

        if (config.roleApprovers) {
            for (const approverType of config.roleApprovers) {
                if (approverType === 'owner') {
                    accessRequestConfig.approvalSchemes?.push({
                        approverType: ApprovalSchemeForRoleV2025ApproverTypeV2025.Owner,
                        approverId: undefined,
                    })
                } else if (approverType === 'manager') {
                    accessRequestConfig.approvalSchemes?.push({
                        approverType: ApprovalSchemeForRoleV2025ApproverTypeV2025.Manager,
                        approverId: undefined,
                    })
                } else if (approverType === 'sourceOwner') {
                    // Roles do not support SOURCE_OWNER or arbitrary IDENTITY approvers directly.
                    // Only OWNER, MANAGER, GOVERNANCE_GROUP are supported.
                    logger.warn(`'sourceOwner' approver type is not supported for Roles in v2025 API. Skipping.`)
                }
            }
        }

        if (config.roleGovernanceGroupNames) {
            for (const govGroupName of config.roleGovernanceGroupNames) {
                let govGroupId: string | undefined
                if (this.governanceGroupCache.has(govGroupName)) {
                    govGroupId = this.governanceGroupCache.get(govGroupName)
                } else {
                    const id = await this.client.getGovernanceGroupId(govGroupName)
                    if (id) {
                        govGroupId = id
                        this.governanceGroupCache.set(govGroupName, govGroupId)
                    }
                }

                if (govGroupId && govGroupId !== 'NOT_FOUND') {
                    accessRequestConfig.approvalSchemes?.push({
                        approverType: ApprovalSchemeForRoleV2025ApproverTypeV2025.GovernanceGroup,
                        approverId: govGroupId,
                    })
                } else if (govGroupId === 'NOT_FOUND') {
                    // Skip - already logged during cache prewarming
                } else {
                    logger.warn(`Could not find Governance Group: ${govGroupName}`)
                }
            }
        }

        return accessRequestConfig
    }

    /**
     * Resolve Revocation Request Config with caching
     */
    private async resolveRevocationRequestConfig(
        config: EntitlementSource,
        sourceName: string
    ): Promise<RevocabilityForRoleV2025> {
        const revocationRequestConfig: RevocabilityForRoleV2025 = {
            approvalSchemes: [],
        }

        if (config.roleRevocationApprovers) {
            for (const approverType of config.roleRevocationApprovers) {
                if (approverType === 'owner') {
                    revocationRequestConfig.approvalSchemes?.push({
                        approverType: ApprovalSchemeForRoleV2025ApproverTypeV2025.Owner,
                        approverId: undefined,
                    })
                } else if (approverType === 'manager') {
                    revocationRequestConfig.approvalSchemes?.push({
                        approverType: ApprovalSchemeForRoleV2025ApproverTypeV2025.Manager,
                        approverId: undefined,
                    })
                } else if (approverType === 'sourceOwner') {
                    logger.warn(`'sourceOwner' approver type is not supported for Roles in v2025 API. Skipping.`)
                }
            }
        }

        if (config.roleRevocationGovernanceGroupNames) {
            for (const govGroupName of config.roleRevocationGovernanceGroupNames) {
                let govGroupId: string | undefined
                if (this.governanceGroupCache.has(govGroupName)) {
                    govGroupId = this.governanceGroupCache.get(govGroupName)
                } else {
                    const id = await this.client.getGovernanceGroupId(govGroupName)
                    if (id) {
                        govGroupId = id
                        this.governanceGroupCache.set(govGroupName, govGroupId)
                    }
                }

                if (govGroupId && govGroupId !== 'NOT_FOUND') {
                    revocationRequestConfig.approvalSchemes?.push({
                        approverType: ApprovalSchemeForRoleV2025ApproverTypeV2025.GovernanceGroup,
                        approverId: govGroupId,
                    })
                } else if (govGroupId === 'NOT_FOUND') {
                    // Skip - already logged during cache prewarming
                } else {
                    logger.warn(`Could not find Revocation Governance Group: ${govGroupName}`)
                }
            }
        }

        return revocationRequestConfig
    }

    /**
     * Resolve Segments with caching
     */
    private async resolveSegments(config: EntitlementSource): Promise<string[]> {
        const segmentIds: string[] = []
        if (config.roleSegmentNames) {
            for (const segName of config.roleSegmentNames) {
                let segId: string | undefined
                if (this.segmentCache.has(segName)) {
                    segId = this.segmentCache.get(segName)
                } else {
                    const id = await this.client.searchSegment(segName)
                    if (id) {
                        segId = id
                        this.segmentCache.set(segName, segId)
                    }
                }

                if (segId && segId !== 'NOT_FOUND') {
                    segmentIds.push(segId)
                } else if (segId === 'NOT_FOUND') {
                    // Skip - already logged during cache prewarming
                } else {
                    logger.warn(`Could not find Segment: ${segName}`)
                    this.segmentCache.set(segName, 'NOT_FOUND') // Negative caching for runtime lookups
                }
            }
        }
        return segmentIds
    }

    /**
     * Render a Velocity template with entitlement context
     */
    private renderTemplate(template: string, entitlement: EntitlementData, sourceName: string): string {
        const now = new Date()

        // Helper function for date formatting
        const formatdate = (date: Date, formatStr: string) => {
            // Basic implementation or use a library if available.
            // For now, let's support simple ISO or locale string, or basic replacements.
            // A full implementation would need date-fns or moment.
            // Let's try to support basic tokens: yyyy, MM, dd
            let s = formatStr
            const yyyy = date.getFullYear().toString()
            const MM = (date.getMonth() + 1).toString().padStart(2, '0')
            const dd = date.getDate().toString().padStart(2, '0')
            const HH = date.getHours().toString().padStart(2, '0')
            const mm = date.getMinutes().toString().padStart(2, '0')
            const ss = date.getSeconds().toString().padStart(2, '0')

            s = s.replace('yyyy', yyyy).replace('MM', MM).replace('dd', dd)
            s = s.replace('HH', HH).replace('mm', mm).replace('ss', ss)
            return s
        }

        // Helper to sanitize input for Velocity
        const sanitize = (str: string | undefined | null): string => {
            if (!str) return ''
            // Don't escape $ - Velocity handles it safely when used as data
            // Escaping causes the output to contain \$ instead of $
            return str
        }

        const context = {
            _source: sanitize(sourceName),
            _value: sanitize(entitlement.value || entitlement.name),
            _displayName: sanitize(entitlement.displayName || entitlement.name),
            _attribute: sanitize(entitlement.attribute || 'group'),
            _type: sanitize(entitlement.type || 'entitlement'),
            now: now,
            formatdate: formatdate,
        }

        try {
            return Velocity.render(template, context)
        } catch (error) {
            logger.error(`Failed to render template '${template}': ${error}`)
            return template
        }
    }

    /**
     * Get all sources with their IDs for membership criteria parsing
     */
    private async getAllSources(): Promise<Source[]> {
        try {
            const sources = await this.client.listAllSources()
            return sources.map((s: any) => ({ id: s.id, name: s.name }))
        } catch (error: any) {
            logger.error(`Failed to fetch sources: ${error.message}`)
            return []
        }
    }
}
