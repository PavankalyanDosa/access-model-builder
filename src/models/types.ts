export interface ConnectorConfig {
    baseurl: string
    clientId: string
    clientSecret: string
    dryRun?: boolean
    executionLimit?: number
    processingType?: 'serial' | 'parallel'
    workflowId: string
    workflowClientId: string
    workflowClientSecret: string
    entitlementSources: EntitlementSource[]
    targetSources: TargetSource[]
}

export interface EntitlementSource {
    sourceName: string
    entitlementTypes: string[]
    enableSync?: boolean
    // Role Configuration (Per Source)
    roleNameTemplate?: string
    roleNameCase?: 'original' | 'upper' | 'lower'
    roleDescriptionTemplate?: string
    roleDescriptionCase?: 'original' | 'upper' | 'lower'
    roleEnabled?: boolean
    roleRequestable?: boolean
    roleOwnerType?: 'sourceOwner' | 'individual'
    roleOwnerName?: string
    roleCreationStyle?: 'all' | 'any'
    roleApprovers?: string[]
    roleGovernanceGroupNames?: string[]
    roleSegmentNames?: string[]
    roleMembershipCriteria?: string
    roleAccessRequestCommentsRequired?: boolean
    roleAccessRequestDenialCommentsRequired?: boolean
    roleRevocationApprovers?: string[]
    roleRevocationGovernanceGroupNames?: string[]

    // Access Profile Configuration
    accessProfileCreation?: boolean
    accessProfileNameTemplate?: string
    accessProfileOwnerType?: 'sourceOwner' | 'individual'
    accessProfileOwnerName?: string
    accessProfileEnabled?: boolean
    accessProfileRequestable?: boolean

    // Advanced Filtering
    enableFiltering?: boolean
    includePatterns?: string[]
    excludePatterns?: string[]
    nativeFilter?: string
}

export interface TargetSource {
    sourceName: string
    standard?: boolean
    enableWorkflowLaunch?: boolean
    workflowName?: string
    workflowId?: string
    workflowClientId?: string
    workflowClientSecret?: string
}

export interface EntitlementData {
    id: string
    name: string
    displayName?: string
    value?: string
    attribute?: string
    type?: string
    sourceSchemaObjectType?: string
    description?: string
    attributes?: any
    source?: {
        id: string
        name: string
    }
}

export interface WorkflowInput {
    displayName: string
    value: string
    type: string
    description?: string
    attributes?: any
    targetSourceId: string
}
