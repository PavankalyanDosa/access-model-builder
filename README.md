# Access Model Builder

A SailPoint Identity Security Cloud (ISC) SaaS connector that automates entitlement synchronization and builds complete access models with Access Profiles and Roles.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Configuration](#configuration)
  - [Global Settings](#global-settings)
  - [Auth Sources](#auth-sources)
  - [Target Sources](#target-sources)
- [Role Management](#role-management)
  - [Automatic Role Creation](#automatic-role-creation)
  - [Membership Criteria](#membership-criteria)
  - [Velocity Templating](#velocity-templating)
- [Advanced Features](#advanced-features)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Overview

The Access Model Builder connector automates the synchronization of entitlements between authoritative sources (Auth Sources) and target systems (Target Sources) in SailPoint ISC. It automatically creates and manages Access Profiles and Roles based on entitlements, with sophisticated governance controls and dynamic membership assignment.

### Key Capabilities

- **Bi-directional Sync**: Read entitlements from Auth Sources and propagate to Target Sources
- **Automatic Role Creation**: Generate Roles from entitlements with customizable naming and governance
- **Dynamic Role Assignment**: Use SCIM-like criteria with Velocity templating for intelligent role membership
- **Flexible Filtering**: Glob patterns, exclude patterns, and native API filters
- **Parallel Processing**: Concurrent processing with configurable execution limits
- **Dry Run Mode**: Test configurations without making changes

## Features

### Entitlement Synchronization

- Stream entitlements from multiple Auth Sources
- Filter entitlements using:
  - Glob include patterns (e.g., `Admin-*`, `*-VPN`)
  - Glob exclude patterns (e.g., `Test-*`, `*_OLD`)
  - Native API filters (source-specific syntax)
- Launch workflows to create/update entitlements in Target Sources
- Parallel or sequential processing modes
- Configurable execution limits per source

### Role Management

- Automatic role creation from entitlements
- **Access Profile creation** (ISC best practice)
  - Wrap entitlements in Access Profiles before assigning to Roles
  - Configurable via `accessProfileNameTemplate`
  - Can be used independently or alongside Roles
- Customizable role naming with Velocity templates
- Full governance configuration:
  - Role owners (individual, source owner, or governance group)
  - Approval workflows (owner, manager, governance group)
  - Segment assignment
  - Access request settings
  - Revocation policies
- Dynamic role membership using SCIM-like criteria
- Content-based delta detection (only update when changes detected)

### Workflow Integration

- Global workflow for all Target Sources
- Source-specific workflow overrides
- Separate client credentials per workflow
- Automatic workflow execution with entitlement data

## Architecture

```
┌─────────────────┐
│  Auth Sources   │ (ServiceNow, Active Directory, etc.)
│  (Authoritative)│
└────────┬────────┘
         │
         │ Read Entitlements
         ▼
┌─────────────────────────────┐
│   UAM Connector             │
│                             │
│  • Filter Entitlements      │
│  • Create/Update Roles      │
│  • Apply Governance         │
│  • Assign Membership        │
└────────┬────────────────────┘
         │
         │ Launch Workflows
         ▼
┌─────────────────┐
│ Target Sources  │ (Okta, Azure AD, etc.)
│  (Destinations) │
└─────────────────┘
```

## Configuration

### Global Settings

```json
{
  "baseurl": "https://your-tenant.api.identitynow.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "dryRun": false,
  "executionLimit": 100,
  "processingType": "parallel",
  "workflowId": "global-workflow-id",
  "workflowClientId": "workflow-client-id",
  "workflowClientSecret": "workflow-client-secret"
}
```

#### Configuration Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `baseurl` | string | Yes | ISC tenant API URL |
| `clientId` | string | Yes | Personal Access Token client ID |
| `clientSecret` | string | Yes | Personal Access Token secret |
| `dryRun` | boolean | No | If true, log actions without making changes (default: false) |
| `executionLimit` | number | No | Max entitlements to process per source (default: unlimited) |
| `processingType` | string | No | `"parallel"` or `"sequential"` (default: parallel) |
| `workflowId` | string | No | Global workflow ID for all Target Sources |
| `workflowClientId` | string | No | Client ID for workflow execution |
| `workflowClientSecret` | string | No | Client secret for workflow execution |

### Auth Sources

Auth Sources are the authoritative systems where entitlements originate.

```json
{
  "entitlementSources": [
    {
      "sourceName": "ServiceNow",
      "entitlementTypes": ["roles", "groups"],
      "enableFiltering": true,
      "includePatterns": ["Admin-*", "*-VPN"],
      "excludePatterns": ["Test-*", "*_OLD"],
      "nativeFilter": "name sw \"Prod\"",
      "roleCreation": true,
      "roleNameTemplate": "UAM - ${_value} - ${_source}",
      "roleOwnerType": "individual",
      "roleOwnerName": "spadmin",
      "roleMembershipCriteria": "identity.department eq \"IT\""
    }
  ]
}
```

#### Auth Source Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceName` | string | Yes | Name of the source in ISC |
| `entitlementTypes` | array | Yes | Types to sync (e.g., `["groups", "roles"]`) |
| `enableFiltering` | boolean | No | Enable pattern/native filtering |
| `includePatterns` | array | No | Glob patterns to include (e.g., `["Admin-*"]`) |
| `excludePatterns` | array | No | Glob patterns to exclude (e.g., `["Test-*"]`) |
| `nativeFilter` | string | No | Source-specific API filter (e.g., `type eq "group"`) |
| `accessProfileNameTemplate` | string | No | Velocity template for Access Profile names (e.g., `AP - ${_value}`) |
| `roleCreation` | boolean | No | Enable automatic role creation (default: false) |
| `roleNameTemplate` | string | No | Velocity template for role names from entitlements |
| `roleOwnerType` | string | No | `"individual"`, `"source"`, or `"governance"` |
| `roleOwnerName` | string | No | Owner name/alias (for individual type) |
| `roleMembershipCriteria` | string | No | SCIM-like criteria for role assignment |

### Target Sources

Target Sources are destination systems where entitlements are created/updated.

```json
{
  "targetSources": [
    {
      "sourceName": "Okta",
      "standard": true,
      "workflowName": "UAM - Okta Create Entitlements",
      "workflowId": "okta-specific-workflow-id",
      "workflowClientId": "okta-workflow-client-id",
      "workflowClientSecret": "okta-workflow-secret"
    },
    {
      "sourceName": "Azure AD",
      "standard": false
    }
  ]
}
```

#### Target Source Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceName` | string | Yes | Name of the target source in ISC |
| `standard` | boolean | No | Use source-specific workflow (true) or global (false) |
| `workflowName` | string | No | Descriptive name for logging |
| `workflowId` | string | No | Source-specific workflow ID (if standard=true) |
| `workflowClientId` | string | No | Client ID for this workflow |
| `workflowClientSecret` | string | No | Client secret for this workflow |

## Role Management

### Automatic Role Creation

The connector can automatically create Roles from entitlements with full governance configuration.

### Access Profile Management

**Best Practice:** SailPoint recommends wrapping entitlements in Access Profiles before assigning them to Roles. This provides better reusability and cleaner access models.

**Important:** Access Profiles are only created if the entitlement exists in the target source. This validation ensures Access Profiles reference valid, synced entitlements.

#### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `accessProfileCreation` | boolean | `false` | Enable Access Profile creation |
| `accessProfileNameTemplate` | string | - | Velocity template for AP names (e.g., `AP - ${_value}`) |
| `accessProfileOwnerType` | string | - | `sourceOwner` or `individual` |
| `accessProfileOwnerName` | string | - | Owner name/alias (required if type is `individual`) |
| `accessProfileEnabled` | boolean | `true` | Must be `true` to use in Roles |
| `accessProfileRequestable` | boolean | `false` | Allow direct AP requests (typically `false` when used in Roles) |

#### Configuration Scenarios

The connector supports multiple configuration patterns based on your needs:

| `accessProfileCreation` | `roleCreation` | Result | Use Case |
|------------------------|----------------|---------|----------|
| ✅ `true` | ✅ `true` | Creates **both** AP and Role | **Recommended**: AP assigned to Role (best practice) |
| ✅ `true` | ❌ `false` | Creates **only** Access Profile | Standalone APs for manual role composition |
| ❌ `false` | ✅ `true` | Creates **only** Role | Legacy: Direct entitlement-to-role assignment |
| ❌ `false` | ❌ `false` | Creates **nothing** | Only sync entitlements to target sources |

**Note:** When `accessProfileCreation=true` and `roleCreation=true`, entitlements are assigned to Roles via Access Profiles (not directly).

#### Access Profile Only

Create Access Profiles without Roles:

```json
{
  "accessProfileCreation": true,
  "accessProfileNameTemplate": "AP - ${_value}",
  "accessProfileOwnerType": "sourceOwner",
  "accessProfileEnabled": true,
  "accessProfileRequestable": false
}
```

#### Access Profiles + Roles (Recommended)

Create both Access Profiles and Roles:

```json
{
  "accessProfileCreation": true,
  "accessProfileNameTemplate": "AP - ${_value}",
  "accessProfileOwnerType": "individual",
  "accessProfileOwnerName": "spadmin",
  "accessProfileEnabled": true,
  "accessProfileRequestable": false,
  "roleCreation": true,
  "roleNameTemplate": "Role - ${_value}"
}
```

The connector will:
1. **Validate** entitlement exists in target source
2. Create/update the Access Profile
3. Create/update the Role
4. Assign the Access Profile to the Role (not the raw entitlement)

#### Role Naming

Use Velocity templates to generate dynamic role names:

```
"roleNameTemplate": "UAM - ${_value} - ${_source} - ${_type}"
```

**Available Variables:**
- `$_source` - Source name (e.g., "ServiceNow")
- `$_value` - Entitlement value (e.g., "Admin-VPN")
- `$_displayName` - Entitlement display name
- `$_attribute` - Entitlement attribute
- `$_type` - Entitlement type (e.g., "groups")

**Example Output:** `UAM - Admin-VPN - ServiceNow - groups`

#### Role Ownership

Three ownership models:

1. **Individual Owner**
```json
{
  "roleOwnerType": "individual",
  "roleOwnerName": "spadmin"
}
```

2. **Source Owner**
```json
{
  "roleOwnerType": "source"
}
```
Uses the owner of the Auth Source.

3. **Governance Group**
```json
{
  "roleOwnerType": "governance",
  "roleGovernanceGroupName": "Security Approvers"
}
```

#### Approval Workflows

Configure who approves role requests:

```json
{
  "roleRequireApprovalForAddition": true,
  "roleApprovers": ["owner", "manager"],
  "roleGovernanceGroupName": "Security Approvers",
  "roleAccessRequestCommentsRequired": true,
  "roleAccessRequestDenialCommentsRequired": true
}
```

**Approver Types:**
- `"owner"` - Role owner
- `"manager"` - Requester's manager
- `"governance"` - Governance group (specified in `roleGovernanceGroupName`)

#### Revocation Policies

```json
{
  "roleRequireApprovalForRemoval": true,
  "roleRevocationApprovers": ["owner"],
  "roleRevocationGovernanceGroupName": "Security Approvers"
}
```

### Role Membership Criteria Format

Define who automatically gets assigned to roles using a SCIM-like syntax combined with Velocity templating. This format allows for flexible, dynamic role assignment based on identity attributes, account attributes, and entitlements.

#### Syntax Reference

The criteria string is composed of one or more expressions connected by logical operators.

**Basic Expression Format:**
`<attribute> <operator> "<value>"`

**Attribute Types:**

1.  **Identity Attributes:**
    *   Syntax: `identity.<attributeName>`
    *   Example: `identity.department`
    *   Description: Attributes belonging to the Identity in SailPoint.

2.  **Account Attributes:**
    *   Syntax: `'<sourceName>'.attribute.<attributeName>`
    *   Example: `'Active Directory'.attribute.department`
    *   Description: Attributes from a specific account on a source. **Note:** Source names with spaces must be enclosed in single quotes.

3.  **Entitlement Attributes:**
    *   Syntax: `'<sourceName>'.entitlement.<attributeName>`
    *   Example: `'ServiceNow'.entitlement.memberOf`
    *   Description: Attributes of an entitlement on a source.

**Operators:**

| Operator | Description | Example |
| :--- | :--- | :--- |
| `eq` | **Equals**: The attribute value must exactly match. | `identity.department eq "IT"` |
| `ne` | **Not Equals**: The attribute value must not match. | `identity.location ne "Austin"` |
| `co` | **Contains**: The attribute value must contain the substring. | `identity.title co "Manager"` |
| `sw` | **Starts With**: The attribute value must start with the string. | `identity.lastname sw "Smi"` |
| `ew` | **Ends With**: The attribute value must end with the string. | `identity.email ew "@example.com"` |

**Logical Operators:**

*   `and`: Both conditions must be true.
*   `or`: At least one condition must be true.
*   `()`: Parentheses are used for grouping expressions to control precedence.

#### Examples

**Simple Identity Attribute:**
```
identity.department eq "IT"
```

**Multiple Conditions (AND):**
```
identity.department eq "IT" and identity.cloudLifecycleState eq "active"
```

**Account Attribute from Specific Source:**
```
'Active Directory'.attribute.employeeType eq "FTE"
```

**Entitlement-Based:**
```
'ServiceNow'.entitlement.memberOf eq "VPN-Users"
```

**Complex Logic with Grouping:**
```
(identity.department eq "IT" or identity.department eq "Engineering") and identity.cloudLifecycleState eq "active"
```

#### Best Practices

1.  **Use Quotes for Values:** Always enclose string values in double quotes (e.g., `"IT"`, `"active"`).
2.  **Quote Source Names with Spaces:** If a source name contains spaces, enclose it in single quotes (e.g., `'Active Directory'`).
3.  **Case Sensitivity:** Source names and attribute names are generally case-sensitive. Ensure they match exactly what is in SailPoint.
4.  **Test Complex Logic:** When using multiple `and`/`or` operators, use parentheses to explicitly define the order of operations.
5.  **Verify Attribute Names:** Double-check that you are using the correct technical name of the attribute (e.g., `sAMAccountName` vs `samaccountname`).

### Velocity Templating

Use Velocity templates in membership criteria for dynamic values:

```
identity.department eq "$_value" and identity.cloudLifecycleState eq "active"
```

**Available Variables:**
- `$_source` - Source name
- `$_value` - Entitlement value
- `$_displayName` - Entitlement display name
- `$_attribute` - Entitlement attribute
- `$_type` - Entitlement type
- `$now` - Current date/time
- `$formatdate()` - Date formatting function

**Example with Date:**
```
identity.startDate sw "$formatdate($now, 'yyyy-MM')"
```

**Example with Dynamic Department:**
```
identity.department eq "$_value" and identity.location eq "Austin"
```

## Advanced Features

### Filtering Strategies

#### 1. Glob Patterns

Include only specific patterns:
```json
{
  "includePatterns": ["Admin-*", "*-VPN", "Prod-*"]
}
```

Exclude test/deprecated entitlements:
```json
{
  "excludePatterns": ["Test-*", "*_OLD", "*-Deprecated"]
}
```

#### 2. Native Filters

Use source-specific filter syntax:

**SCIM Filter (most sources):**
```json
{
  "nativeFilter": "name sw \"Prod\" and type eq \"group\""
}
```

**ServiceNow:**
```json
{
  "nativeFilter": "active=true^sys_created_on>javascript:gs.daysAgoStart(30)"
}
```

#### 3. Combined Filtering

Filters are applied in order:
1. Native filter (server-side)
2. Entitlement types
3. Include patterns (client-side)
4. Exclude patterns (client-side)

```json
{
  "nativeFilter": "name sw \"Prod\"",
  "entitlementTypes": ["groups"],
  "includePatterns": ["Admin-*"],
  "excludePatterns": ["*-Test"]
}
```

### Processing Modes

#### Parallel Processing (Default)

Process sources concurrently with per-source limits:

```json
{
  "processingType": "parallel",
  "executionLimit": 50
}
```

- Faster overall execution
- Each source processes up to `executionLimit` entitlements
- Sources run simultaneously

#### Sequential Processing

Process sources one at a time:

```json
{
  "processingType": "sequential",
  "executionLimit": 100
}
```

- Predictable resource usage
- Easier debugging
- Total limit across all sources

### Dry Run Mode

Test configurations without making changes:

```json
{
  "dryRun": true,
  "executionLimit": 10
}
```

The connector will:
- ✅ Read entitlements
- ✅ Apply filters
- ✅ Log what would be created/updated
- ❌ NOT create/update roles
- ❌ NOT launch workflows
- ❌ NOT make API changes

## Examples

### Example 1: Basic ServiceNow to Okta Sync

```json
{
  "baseurl": "https://acme.api.identitynow.com",
  "clientId": "abc123",
  "clientSecret": "secret123",
  "workflowId": "global-workflow-id",
  "entitlementSources": [
    {
      "sourceName": "ServiceNow",
      "entitlementTypes": ["groups"],
      "roleCreation": true,
      "roleNameTemplate": "SNOW - ${_value}",
      "roleOwnerType": "individual",
      "roleOwnerName": "spadmin"
    }
  ],
  "targetSources": [
    {
      "sourceName": "Okta",
      "standard": false
    }
  ]
}
```

### Example 2: Advanced Filtering with Role Governance

```json
{
  "entitlementSources": [
    {
      "sourceName": "Active Directory",
      "entitlementTypes": ["group"],
      "enableFiltering": true,
      "includePatterns": ["Admin-*", "Prod-*"],
      "excludePatterns": ["*-Test", "*_OLD"],
      "nativeFilter": "name sw \"Corp\"",
      "roleCreation": true,
      "roleNameTemplate": "AD - ${_value}",
      "roleOwnerType": "governance",
      "roleGovernanceGroupName": "Security Team",
      "roleRequireApprovalForAddition": true,
      "roleApprovers": ["owner", "manager"],
      "roleAccessRequestCommentsRequired": true,
      "roleMembershipCriteria": "identity.department eq \"IT\" and identity.cloudLifecycleState eq \"active\""
    }
  ]
}
```

### Example 3: Multi-Source with Dynamic Membership

```json
{
  "entitlementSources": [
    {
      "sourceName": "ServiceNow",
      "entitlementTypes": ["roles", "groups"],
      "roleCreation": true,
      "roleNameTemplate": "UAM - ${_value} - SNOW",
      "roleOwnerType": "individual",
      "roleOwnerName": "spadmin",
      "roleMembershipCriteria": "identity.department eq \"$_value\""
    },
    {
      "sourceName": "Active Directory",
      "entitlementTypes": ["group"],
      "roleCreation": true,
      "roleNameTemplate": "UAM - ${_value} - AD",
      "roleOwnerType": "source",
      "roleMembershipCriteria": "'Active Directory'.attribute.employeeType eq \"FTE\" and identity.cloudLifecycleState eq \"active\""
    }
  ],
  "targetSources": [
    {
      "sourceName": "Okta",
      "standard": true,
      "workflowId": "okta-workflow-id"
    },
    {
      "sourceName": "Azure AD",
      "standard": false
    }
  ]
}
```

### Example 4: Department-Based Role Assignment

```json
{
  "entitlementSources": [
    {
      "sourceName": "HR System",
      "entitlementTypes": ["groups"],
      "roleCreation": true,
      "roleNameTemplate": "${_value} Access",
      "roleOwnerType": "governance",
      "roleGovernanceGroupName": "Department Managers",
      "roleMembershipCriteria": "(identity.department eq \"$_value\" or identity.department eq \"${_value}-Contractors\") and identity.cloudLifecycleState eq \"active\"",
      "roleRequireApprovalForAddition": true,
      "roleApprovers": ["manager", "governance"],
      "roleSegmentNames": ["Employees"]
    }
  ]
}
```

### Example 5: Location-Based with Multiple Approvers

```json
{
  "entitlementSources": [
    {
      "sourceName": "Building Access",
      "entitlementTypes": ["groups"],
      "roleCreation": true,
      "roleNameTemplate": "Building - ${_value}",
      "roleOwnerType": "governance",
      "roleGovernanceGroupName": "Facilities Team",
      "roleMembershipCriteria": "identity.location eq \"$_value\" and identity.cloudLifecycleState eq \"active\"",
      "roleRequireApprovalForAddition": true,
      "roleApprovers": ["owner", "manager", "governance"],
      "roleAccessRequestCommentsRequired": true,
      "roleRequireApprovalForRemoval": true,
      "roleRevocationApprovers": ["governance"]
    }
  ]
}
```

## Troubleshooting

### Common Issues

#### 1. Roles Not Being Created

**Check:**
- `roleCreation` is set to `true`
- Role name template is valid
- Owner exists in ISC
- Governance group exists (if using governance owner type)

**Debug:**
```json
{
  "dryRun": true,
  "executionLimit": 1
}
```

#### 2. Membership Criteria Not Working

**Common Mistakes:**
- ❌ `identity.attribute.department` (wrong - extra `attribute`)
- ✅ `identity.department` (correct)
- ❌ `Active Directory.attribute.foo` (wrong - missing quotes)
- ✅ `'Active Directory'.attribute.foo` (correct)

**Verify Syntax:**
- Check [format documentation](https://github.com/yannick-beot-sp/vscode-sailpoint-identitynow?tab=readme-ov-file#roles)
- Use simple criteria first, then add complexity
- Test with dry run mode

#### 3. Workflows Not Triggering

**Check:**
- Workflow ID is correct
- Workflow client credentials are valid
- Workflow is enabled in ISC
- Target source exists

#### 4. Filtering Not Working

**Glob Patterns:**
- Use `*` for wildcards
- Patterns are case-sensitive
- Test patterns individually

**Native Filters:**
- Use source-specific syntax
- Check source API documentation
- Verify filter in source UI first

#### 5. Performance Issues

**Solutions:**
- Reduce `executionLimit`
- Use `sequential` processing
- Add more specific filters
- Enable filtering to reduce entitlements processed

### Logging

The connector provides detailed logging:

```
{"level":"INFO","message":"Streaming entitlements from source: ServiceNow"}
{"level":"INFO","message":"Source ServiceNow has 150 total entitlements matching filter"}
{"level":"INFO","message":"Checking existence of Role: UAM - Admin-VPN - SNOW"}
{"level":"INFO","message":"Role created successfully: UAM - Admin-VPN - SNOW"}
{"level":"INFO","message":"Workflow triggered successfully for entitlement admin-vpn"}
```

**Log Levels:**
- `INFO` - Normal operations
- `WARN` - Non-critical issues
- `ERROR` - Failures requiring attention
- `DEBUG` - Detailed diagnostic information

### Best Practices

1. **Start with Dry Run**
   - Always test new configurations with `dryRun: true`
   - Use small `executionLimit` for testing

2. **Use Specific Filters**
   - Combine native filters with glob patterns
   - Filter at the source when possible (better performance)

3. **Incremental Rollout**
   - Start with one Auth Source
   - Add Target Sources gradually
   - Test role creation before adding membership criteria

4. **Monitor Execution**
   - Check logs for errors
   - Verify roles are created correctly
   - Confirm workflows are triggering

5. **Governance Planning**
   - Define ownership model upfront
   - Document approval workflows
   - Test with real approvers

## Additional Resources

- [SailPoint ISC Documentation](https://documentation.sailpoint.com/)
- [Velocity Template Language](https://velocity.apache.org/engine/devel/user-guide.html)
- [SCIM Filter Syntax](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2)

## Support

For issues or questions:
1. Check logs for error messages
2. Review this documentation
3. Test with dry run mode
4. Verify configuration against examples
