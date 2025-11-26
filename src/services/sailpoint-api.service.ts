import { Configuration, EntitlementsBetaApi, WorkflowsBetaApi, SourcesApi, Paginator } from 'sailpoint-api-client'
import {
    RolesV2025Api,
    SearchV2025Api,
    SegmentsV2025Api,
    GovernanceGroupsV2025Api,
    RoleV2025,
    JsonPatchOperationV2025,
    SegmentV2025,
    WorkgroupDtoV2025,
    AttributeDTOListV2025,
    AttributeDTOV2025,
    AccessModelMetadataV2025Api,
    AccessProfilesV2025Api,
    AccessProfileV2025,
} from 'sailpoint-api-client/dist/v2025'
// axios is only required for manual OAuth token flow (workflow execution)
import axios from 'axios'
import { logger } from '@sailpoint/connector-sdk'
import { EntitlementData } from '../models/types'

/**
 * Service for interacting with SailPoint ISC APIs using the official SDK
 */
export class SailPointApiService {
    private config: Configuration
    private rolesApi: RolesV2025Api
    private accessProfilesApi: AccessProfilesV2025Api
    private searchApi: SearchV2025Api
    private segmentsApi: SegmentsV2025Api
    private governanceGroupsApi: GovernanceGroupsV2025Api
    private sourcesApi: SourcesApi
    private accessModelMetadataApi: AccessModelMetadataV2025Api

    constructor(baseUrl: string, clientId: string, clientSecret: string) {
        this.config = new Configuration({
            baseurl: baseUrl,
            clientId: clientId,
            clientSecret: clientSecret,
            tokenUrl: new URL(baseUrl).origin + '/oauth/token',
        })

        // Enable experimental APIs (required for Governance Groups)
        ;(this.config as any).experimental = true

        // Initialize v2025 API clients
        this.rolesApi = new RolesV2025Api(this.config)
        this.accessProfilesApi = new AccessProfilesV2025Api(this.config)
        this.searchApi = new SearchV2025Api(this.config)
        this.segmentsApi = new SegmentsV2025Api(this.config)
        this.governanceGroupsApi = new GovernanceGroupsV2025Api(this.config)
        this.sourcesApi = new SourcesApi(this.config)
        this.accessModelMetadataApi = new AccessModelMetadataV2025Api(this.config)
    }

    /**
     * Helper to get access token using client credentials from config
     */
    private async getAccessToken(): Promise<string> {
        const tokenUrl = new URL(this.config.basePath || '').origin + '/oauth/token'
        const params = new URLSearchParams()
        params.append('grant_type', 'client_credentials')
        params.append('client_id', this.config.clientId || '')
        params.append('client_secret', this.config.clientSecret || '')

        const tokenResponse = await axios.post(tokenUrl, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        return tokenResponse.data.access_token
    }

    /**
     * Test connection to SailPoint ISC
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.sourcesApi.listSources({ limit: 1 })
            return true
        } catch (error: any) {
            logger.error(`Connection test failed: ${error.message}`)
            throw error
        }
    }

    /**
     * Resolve source name to source ID
     */
    async resolveSourceIdByName(name: string): Promise<string | null> {
        try {
            const response = await this.sourcesApi.listSources({
                filters: `name eq "${name}"`,
                limit: 1,
            })

            if (response.data && response.data.length > 0) {
                return response.data[0].id || null
            }
            return null
        } catch (e: any) {
            logger.error(`Error resolving source name ${name}: ${e.message}`)
            return null
        }
    }

    /**
     * Fetch a single page of entitlements with total count
     * Returns both the entitlements and the total count from X-Total-Count header
     */
    async fetchEntitlementsPage(
        filter: string,
        offset: number,
        limit: number
    ): Promise<{ entitlements: EntitlementData[]; totalCount: number }> {
        const api = new EntitlementsBetaApi(this.config)

        logger.debug(`Fetching entitlements page: offset=${offset}, limit=${limit}`)

        const response = await api.listEntitlements({
            filters: filter,
            offset: offset,
            limit: limit,
            count: true,
        })

        // Extract total count from response headers or data
        const totalCount = (response as any).headers?.['x-total-count']
            ? parseInt((response as any).headers['x-total-count'])
            : response.data?.length || 0

        return {
            entitlements: response.data as any[],
            totalCount: totalCount,
        }
    }

    /**
     * Fetch entitlements from a source with optional type filters and limit
     */
    async fetchEntitlements(sourceId: string, types: string[] = [], limit?: number): Promise<EntitlementData[]> {
        const api = new EntitlementsBetaApi(this.config)

        let filter = `source.id eq "${sourceId}"`
        if (types.length > 0) {
            const typeFilters = types.map((t: string) => `attribute eq "${t}"`).join(' or ')
            filter += ` and (${typeFilters})`
        }

        logger.info(`Fetching entitlements with filter: ${filter}${limit ? ` (limit: ${limit})` : ''}`)

        // If limit is specified, only fetch that many
        if (limit && limit > 0) {
            const response = await api.listEntitlements({
                filters: filter,
                limit: Math.min(limit, 250), // API max is 250 per page
                count: false,
            })
            return response.data as any[]
        }

        // Otherwise, paginate through all
        const entitlements = await Paginator.paginate(api, api.listEntitlements, {
            filters: filter,
            limit: 250,
            count: true,
        })

        return entitlements.data as any[]
    }

    /**
     * Execute a workflow externally using manual OAuth token handling
     * Note: Uses axios directly as SDK doesn't support application/x-www-form-urlencoded token requests
     */
    async executeWorkflow(
        workflowId: string,
        input: any,
        clientId: string,
        clientSecret: string,
        baseUrl: string
    ): Promise<void> {
        // Ensure we use the origin for the token URL to avoid appending to /beta or /v3
        const tokenUrl = new URL(baseUrl).origin + '/oauth/token'

        logger.debug(
            `Fetching access token from ${tokenUrl} for workflow ${workflowId} (Client ID: ${clientId.substring(
                0,
                5
            )}...)`
        )

        try {
            // Manually fetch access token using application/x-www-form-urlencoded
            const params = new URLSearchParams()
            params.append('grant_type', 'client_credentials')
            params.append('client_id', clientId.trim())
            params.append('client_secret', clientSecret.trim())

            const tokenResponse = await axios.post(tokenUrl, params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            })

            const accessToken = tokenResponse.data.access_token
            if (!accessToken) {
                throw new Error('No access token received from token endpoint')
            }

            // Create config with the fetched token
            const workflowConfig = new Configuration({
                baseurl: baseUrl,
                accessToken: accessToken,
            })

            const api = new WorkflowsBetaApi(workflowConfig)

            logger.info(`Executing workflow ${workflowId}...`)

            await api.postExternalExecuteWorkflow({
                id: workflowId,
                postExternalExecuteWorkflowRequestBeta: {
                    input: input,
                },
            })
        } catch (error: any) {
            // Enhanced error logging
            throw error
        }
    }

    /**
     * Search for a Role by name using SDK
     * Uses listRoles API for immediate consistency (Search API has index lag)
     */
    async searchRole(name: string): Promise<any | null> {
        try {
            const response = await this.rolesApi.listRoles({
                filters: `name eq "${name}"`,
            })

            if (response.data && response.data.length > 0) {
                return response.data[0]
            }
            return null
        } catch (error: any) {
            logger.error(`Error searching for role ${name}: ${error.message}`)
            throw error
        }
    }

    /**
     * Get full Role details by ID using SDK
     */
    async getRole(id: string): Promise<RoleV2025 | null> {
        try {
            const response = await this.rolesApi.getRole({ id })
            return response.data
        } catch (error: any) {
            logger.error(`Error fetching role ${id}: ${error.message}`)
            return null
        }
    }

    /**
     * Update a Role (PATCH) using SDK
     */
    async updateRole(id: string, operations: JsonPatchOperationV2025[]): Promise<RoleV2025> {
        try {
            const response = await this.rolesApi.patchRole({
                id,
                jsonPatchOperationV2025: operations,
            })
            return response.data
        } catch (error: any) {
            logger.error(`Error updating role ${id}: ${error.message}`)
            if (error.response?.data) {
                logger.error(`Error details: ${JSON.stringify(error.response.data)}`)
            }
            throw error
        }
    }

    /**
     * Create a new Role using SDK
     */
    async createRole(roleData: {
        name: string
        description: string
        enabled: boolean
        requestable: boolean
        ownerId?: string
        accessRequestConfig?: any
        revocationRequestConfig?: any
        segments?: string[]
        membership?: any
        accessModelMetadata?: AttributeDTOListV2025
        entitlements?: Array<{ id: string; name?: string }>
    }): Promise<RoleV2025> {
        try {
            const payload: RoleV2025 = {
                name: roleData.name,
                description: roleData.description,
                enabled: roleData.enabled,
                requestable: roleData.requestable,
                owner: {
                    type: 'IDENTITY',
                    id: roleData.ownerId,
                },
                accessProfiles: [],
                membership: roleData.membership || {
                    type: 'STANDARD',
                },
            }

            if (roleData.accessRequestConfig) {
                payload.accessRequestConfig = roleData.accessRequestConfig
            }

            if (roleData.revocationRequestConfig) {
                payload.revocationRequestConfig = roleData.revocationRequestConfig
            }

            if (roleData.segments) {
                payload.segments = roleData.segments
            }

            if (roleData.accessModelMetadata) {
                payload.accessModelMetadata = roleData.accessModelMetadata
            }

            if (roleData.entitlements && roleData.entitlements.length > 0) {
                payload.entitlements = roleData.entitlements.map((ent) => ({
                    type: 'ENTITLEMENT' as any,
                    id: ent.id,
                    name: ent.name,
                }))
            }

            if (!payload.owner?.id) {
                logger.warn('No owner ID provided for Role creation. This might fail.')
            }

            const response = await this.rolesApi.createRole({
                roleV2025: payload,
            })

            return response.data
        } catch (error: any) {
            logger.error(`Error creating role ${roleData.name}: ${error.message}`)
            if (error.response?.data) {
                logger.error(`Error details: ${JSON.stringify(error.response.data)}`)
            }
            throw error
        }
    }

    /**
     * Get User ID by alias/name using SDK
     */
    async getUserId(name: string): Promise<string | null> {
        try {
            const response = await this.searchApi.searchPost({
                searchV2025: {
                    query: {
                        query: `name.exact:"${name}" OR alias.exact:"${name}"`,
                    },
                    indices: ['identities'],
                },
            })

            if (response.data && response.data.length > 0) {
                return response.data[0].id || null
            }
            return null
        } catch (error: any) {
            logger.error(`Error searching for user ${name}: ${error.message}`)
            return null
        }
    }

    /**
     * Search for a Segment by name using SDK
     * Note: Segments are not searchable via Search API, so we list and filter client-side
     */
    async searchSegment(name: string): Promise<string | null> {
        try {
            // List all segments using Paginator to ensure we find it if it exists
            const response = await Paginator.paginate(this.segmentsApi, this.segmentsApi.listSegments, { limit: 250 })

            if (response.data && response.data.length > 0) {
                const segment = response.data.find((s: SegmentV2025) => s.name === name)
                return segment?.id || null
            }
            return null
        } catch (error: any) {
            logger.error(`Error searching for segment ${name}: ${error.message}`)
            return null
        }
    }

    /**
     * Get Source Owner Identity ID using SDK
     */
    async getSourceOwner(sourceId: string): Promise<string | null> {
        try {
            const response = await this.sourcesApi.getSource({ id: sourceId })

            if (response.data && response.data.owner && response.data.owner.id) {
                return response.data.owner.id
            }
            return null
        } catch (error: any) {
            logger.error(`Error fetching source owner for ${sourceId}: ${error.message}`)
            return null
        }
    }

    /**
     * Get Governance Group ID by name using SDK
     */
    async getGovernanceGroupId(name: string): Promise<string | null> {
        try {
            const response = await this.governanceGroupsApi.listWorkgroups({
                filters: `name eq "${name}"`,
            })

            if (response.data && response.data.length > 0) {
                return response.data[0].id || null
            }
            return null
        } catch (error: any) {
            logger.error(`Error searching for governance group ${name}: ${error.message}`)
            return null
        }
    }

    /**
     * Check if an entitlement exists in a specific source using SDK
     */
    async checkEntitlementExists(sourceName: string, attribute: string, value: string): Promise<boolean> {
        try {
            // Robust matching: Check if value matches OR displayName matches
            const query = `source.name.exact:"${sourceName}" AND attribute:"${attribute}" AND (value:"${value}" OR displayName:"${value}")`

            const response = await this.searchApi.searchPost({
                searchV2025: {
                    query: {
                        query: query,
                    },
                    indices: ['entitlements'],
                },
            })

            return response.data && response.data.length > 0
        } catch (error: any) {
            logger.error(`Error checking entitlement existence in ${sourceName}: ${error.message}`)
            return false
        }
    }

    /**
     * Ensure the 'roleManualOverride' metadata attribute exists
     * Uses SDK to get and axios to create (since SDK lacks create method for beta)
     */
    async ensureRoleMetadataAttributeExists(): Promise<void> {
        try {
            // 1. Check if attribute exists using SDK Get
            try {
                await this.accessModelMetadataApi.getAccessModelMetadataAttribute({ key: 'roleManualOverride' })
                logger.info("Metadata attribute 'roleManualOverride' already exists.")
                return
            } catch (error: any) {
                // If 404, it doesn't exist, so proceed to create
                if (error.response && error.response.status === 404) {
                    logger.info("Metadata attribute 'roleManualOverride' missing (404). Creating...")
                } else {
                    // Other error, rethrow or log
                    throw error
                }
            }

            // 2. Create using axios (Beta API)
            const url = `${new URL(this.config.basePath || '').origin}/beta/access-model-metadata/attributes`

            const accessToken = await this.getAccessToken()

            await axios.post(
                url,
                [
                    {
                        key: 'roleManualOverride',
                        name: 'Manual Override',
                        status: 'active',
                        type: 'custom',
                        objectTypes: ['role'],
                        description: 'Manual Override',
                        values: [
                            { name: 'true', value: 'true', status: 'active' },
                            { name: 'false', value: 'false', status: 'active' },
                        ],
                        multiselect: false,
                    },
                ],
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            )

            logger.info("Successfully created 'roleManualOverride' metadata attribute.")
        } catch (error: any) {
            logger.error(`Failed to ensure role metadata attribute exists: ${error.message}`)
            // Don't throw, just log. We don't want to block the whole process if this fails,
            // though role creation might warn later.
        }
    }

    /**
     * Add metadata value to a Role using direct API call
     * POST {{baseUrl}}/roles/:id/access-model-metadata/:attributeKey/values/:attributeValue
     */
    async addRoleMetadata(roleId: string, attributeKey: string, attributeValue: string): Promise<void> {
        try {
            const baseUrl = new URL(this.config.basePath || '').origin
            // Construct URL: /v3/roles/:id/access-model-metadata/:attributeKey/values/:attributeValue
            // Note: The user specified {{baseUrl}}/roles/..., and clarified it's v2025.

            const url = `${baseUrl}/v2025/roles/${roleId}/access-model-metadata/${attributeKey}/values/${attributeValue}`

            const accessToken = await this.getAccessToken()

            await axios.post(
                url,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            )

            logger.info(`Successfully added metadata ${attributeKey}=${attributeValue} to role ${roleId}`)
        } catch (error: any) {
            logger.error(`Failed to add metadata to role ${roleId}: ${error.message}`)
            if (error.response?.data) {
                logger.error(`Error details: ${JSON.stringify(error.response.data)}`)
            }
            // We log but don't throw to avoid breaking the flow if this extra step fails
        }
    }

    /**
     * Search for an Access Profile by name
     */
    async searchAccessProfile(name: string): Promise<AccessProfileV2025 | null> {
        try {
            const response = await this.accessProfilesApi.listAccessProfiles({
                filters: `name eq "${name}"`,
            })

            if (response.data && response.data.length > 0) {
                return response.data[0]
            }
            return null
        } catch (error: any) {
            logger.error(`Error searching for Access Profile ${name}: ${error.message}`)
            return null
        }
    }

    /**
     * Get Access Profile by ID
     */
    async getAccessProfile(id: string): Promise<AccessProfileV2025 | null> {
        try {
            const response = await this.accessProfilesApi.getAccessProfile({ id })
            return response.data
        } catch (error: any) {
            logger.error(`Error fetching Access Profile ${id}: ${error.message}`)
            return null
        }
    }

    /**
     * Create a new Access Profile
     */
    async createAccessProfile(accessProfile: AccessProfileV2025): Promise<AccessProfileV2025 | null> {
        try {
            const response = await this.accessProfilesApi.createAccessProfile({
                accessProfileV2025: accessProfile,
            })
            return response.data
        } catch (error: any) {
            logger.error(`Error creating Access Profile ${accessProfile.name}: ${error.message}`)
            if (error.response) {
                logger.error(`Response data: ${JSON.stringify(error.response.data)}`)
            }
            throw error
        }
    }

    /**
     * Update an existing Access Profile
     */
    async updateAccessProfile(id: string, operations: JsonPatchOperationV2025[]): Promise<AccessProfileV2025 | null> {
        try {
            const response = await this.accessProfilesApi.patchAccessProfile({
                id,
                jsonPatchOperationV2025: operations,
            })
            return response.data
        } catch (error: any) {
            logger.error(`Error updating Access Profile ${id}: ${error.message}`)
            throw error
        }
    }
}
