# Access Model Builder

A SailPoint Identity Security Cloud (ISC) SaaS connector that automates entitlement synchronization and builds complete access models with Access Profiles and Roles.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Global Settings](#global-settings)
  - [Auth Sources](#auth-sources)
  - [Target Sources](#target-sources)
- [Access Profile Management](#access-profile-management)
- [Role Management](#role-management)
  - [Role Membership Criteria Format](#role-membership-criteria-format)
  - [Velocity Templating](#velocity-templating)
- [Advanced Features](#advanced-features)
- [Complete Examples](#complete-examples)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

The **Access Model Builder** connector automates the synchronization of entitlements between authoritative sources (Auth Sources) and target systems (Target Sources) in SailPoint ISC. It automatically creates and manages **Access Profiles** and **Roles** based on entitlements, with sophisticated governance controls and dynamic membership assignment.

### Key Capabilities

- **Entitlement Synchronization**: Read entitlements from Auth Sources and propagate to Target Sources
- **Access Profile Creation**: Wrap entitlements in Access Profiles (ISC best practice)
- **Automatic Role Creation**: Generate Roles from entitlements with customizable naming and governance
- **Dynamic Role Assignment**: Use SCIM-like criteria with Velocity templating for intelligent role membership
- **Advanced Filtering**: Glob patterns, exclude patterns, and native ISC API filters
- **Parallel Processing**: Concurrent processing with configurable execution limits
- **Dry Run Mode**: Test configurations without making changes
- **Target Validation**: Only creates Access Profiles/Roles if entitlements exist in target sources

## Features

### Entitlement Synchronization

- Stream entitlements from multiple Auth Sources
- Filter entitlements using:
  - **Glob include patterns** (e.g., `Admin-*`, `*-VPN`)
  - **Glob exclude patterns** (e.g., `Test-*`, `*_OLD`)
  - **Native ISC API filters** (e.g., `name sw "Admin"`)
- Launch workflows to create/update entitlements in Target Sources
- Parallel or sequential processing modes
- Configurable execution limits per source

### Access Profile Management

- **Best Practice**: Wrap entitlements in Access Profiles before assigning to Roles
- **Target Validation**: Only creates Access Profiles if entitlement exists in target source
- Configurable owner (source owner or individual)
- Enabled/requestable flags
- Can be used independently or alongside Roles
- Automatic updates when entitlements change

### Role Management

- Automatic role creation from entitlements
- Customizable role naming with Velocity templates
- Full governance configuration:
  - Role owners (individual, source owner, or governance group)
  - Approval workflows (owner, manager, governance group)
  - Segment assignment
  - Access request settings
  - Revocation policies
- Dynamic role membership using SCIM-like criteria
- Content-based delta detection (only update when changes detected)
- Manual override via metadata attribute

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
┌──────────────────────────────┐
│  Access Model Builder        │
│                              │
│  • Filter Entitlements       │
│  • Validate Target Existence │
│  • Create Access Profiles    │
│  • Create/Update Roles       │
│  • Apply Governance          │
│  • Assign Membership         │
└────────┬─────────────────────┘
         │
         │ Launch Workflows
         ▼
┌─────────────────┐
│ Target Sources  │ (Okta, Azure AD, etc.)
│  (Destinations) │
└─────────────────┘
```

## Quick Start

### 1. Install the Connector

```bash
npm install
npm run build
npm run pack-zip
sail conn upload -c access-model-builder -f ./dist/access-model-builder-0.1.0.zip
```

### 2. Create a Source

1. In ISC, go to **Admin** > **Connections** > **Sources**
2. Click **Create Source**
3. Select **Access Model Builder**
4. Configure connection details and entitlement sources

### 3. Test Connection

Run a test connection to verify configuration.

## Configuration

### Global Settings

```json
{
  "baseurl": "https://tenant.api.identitynow.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "dryRun": false,
  "executionLimit": 100,
  "processingType": "parallel",
  "workflowId": "global-workflow-id",
  "workflowClientId": "workflow-client-id",
  "workflowClientSecret": "workflow-client-secret",
  "entitlementSources": [...],
  "targetSources": [...]
}
```

#### Global Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `baseurl` | string | Yes | - | ISC tenant URL |
| `clientId` | string | Yes | - | Personal Access Token client ID |
| `clientSecret` | string | Yes | - | Personal Access Token secret |
| `dryRun` | boolean | No | `false` | Test mode (no changes made) |
| `executionLimit` | number | No | `100` | Max entitlements to process per source |
| `processingType` | string | No | `parallel` | `parallel` or `serial` processing |
| `workflowId` | string | Yes | - | Global workflow ID for target sources |
| `workflowClientId` | string | Yes | - | Global workflow client ID |
| `workflowClientSecret` | string | Yes | - | Global workflow client secret |

### Auth Sources

Auth Sources are authoritative systems from which entitlements are read.

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
      "accessProfileCreation": true,
      "accessProfileNameTemplate": "AP - ${_value}",
      "accessProfileOwnerType": "sourceOwner",
      "accessProfileEnabled": true,
      "accessProfileRequestable": false,
      "roleCreation": true,
      "roleNameTemplate": "Role - ${_value} - ${_source}",
      "roleOwnerType": "individual",
      "roleOwnerName": "spadmin",
      "roleEnabled": true,
      "roleRequestable": true,
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
| `enableSync` | boolean | No | Enable synchronization for this source (default: `true`) |
| **Filtering** | | | |
| `enableFiltering` | boolean | No | Enable pattern/native filtering |
| `includePatterns` | array | No | Glob patterns to include (e.g., `["Admin-*"]`) |
| `excludePatterns` | array | No | Glob patterns to exclude (e.g., `["Test-*"]`) |
| `nativeFilter` | string | No | ISC API filter (e.g., `name sw "Admin"`) |
| **Access Profile** | | | |
| `accessProfileCreation` | boolean | No | Enable Access Profile creation |
| `accessProfileNameTemplate` | string | No | Velocity template for AP names |
| `accessProfileOwnerType` | string | No | `sourceOwner` or `individual` |
| `accessProfileOwnerName` | string | No | Owner name (if type is `individual`) |
| `accessProfileEnabled` | boolean | No | Must be `true` to use in Roles (default: `true`) |
| `accessProfileRequestable` | boolean | No | Allow direct AP requests (default: `false`) |
| **Role** | | | |
| `roleCreation` | boolean | No | Enable automatic role creation |
| `roleNameTemplate` | string | No | Velocity template for role names |
| `roleOwnerType` | string | No | `sourceOwner`, `individual`, or `governance` |
| `roleOwnerName` | string | No | Owner name/alias (for individual type) |
| `roleEnabled` | boolean | No | Enable role (default: `true`) |
| `roleRequestable` | boolean | No | Allow role requests (default: `true`) |
| `roleMembershipCriteria` | string | No | Criteria for auto-assignment (e.g., `identity.dept eq 'IT'`) |
| `roleCreationStyle` | string | No | `all` or `any` (default: `any`) |
| `roleSegmentNames` | array | No | Segment names to assign |
| `roleApprovers` | array | No | Approval types: `owner`, `manager`, `sourceOwner` |
| `roleGovernanceGroupNames` | array | No | List of Governance Groups for access approval |
| `roleRevocationApprovers` | array | No | List of revocation approvers (`owner`, `manager`) |
| `roleRevocationGovernanceGroupNames` | array | No | List of Governance Groups for revocation approval |

### Target Sources

Target Sources are destination systems where entitlements are created/updated.

```json
{
  "targetSources": [
    {
      "sourceName": "Okta",
      "standard": true,
      "workflowName": "Access Model Builder - Okta Create Entitlements",
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
| `standard` | boolean | No | Use source-specific workflow (`true`) or global (`false`) |
| `workflowName` | string | No | Descriptive name for logging |
| `workflowId` | string | No | Source-specific workflow ID (if `standard=true`) |
| `workflowClientId` | string | No | Client ID for this workflow |
| `workflowClientSecret` | string | No | Client secret for this workflow |

## Access Profile Management

**Best Practice:** SailPoint recommends wrapping entitlements in Access Profiles before assigning them to Roles. This provides better reusability and cleaner access models.

**Important:** Access Profiles are only created if the entitlement exists in the target source. This validation ensures Access Profiles reference valid, synced entitlements.

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `accessProfileCreation` | boolean | `false` | Enable Access Profile creation |
| `accessProfileNameTemplate` | string | - | Velocity template for AP names (e.g., `AP - ${_value}`) |
| `accessProfileOwnerType` | string | - | `sourceOwner` or `individual` |
| `accessProfileOwnerName` | string | - | Owner name/alias (required if type is `individual`) |
| `accessProfileEnabled` | boolean | `true` | Must be `true` to use in Roles |
| `accessProfileRequestable` | boolean | `false` | Allow direct AP requests (typically `false` when used in Roles) |

### Configuration Scenarios

The connector supports multiple configuration patterns based on your needs:

| `accessProfileCreation` | `roleCreation` | Result | Use Case |
|------------------------|----------------|---------|----------|
| ✅ `true` | ✅ `true` | Creates **both** AP and Role | **Recommended**: AP assigned to Role (best practice) |
| ✅ `true` | ❌ `false` | Creates **only** Access Profile | Standalone APs for manual role composition |
| ❌ `false` | ✅ `true` | Creates **only** Role | Legacy: Direct entitlement-to-role assignment |
| ❌ `false` | ❌ `false` | Creates **nothing** | Only sync entitlements to target sources |

**Note:** When `accessProfileCreation=true` and `roleCreation=true`, entitlements are assigned to Roles via Access Profiles (not directly).

### Access Profile Only

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

### Access Profiles + Roles (Recommended)

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

## Role Management

### Automatic Role Creation

The connector can automatically create Roles from entitlements with full governance configuration.

### Role Naming

Use Velocity templates to generate dynamic role names:

```
"roleNameTemplate": "Access Model Builder - ${_value} - ${_source} - ${_type}"
```

**Available Variables:**
- `$_source` - Source name (e.g., "ServiceNow")
- `$_value` - Entitlement value (e.g., "Admin-VPN")
- `$_displayName` - Entitlement display name
- `$_attribute` - Entitlement attribute
- `$_type` - Entitlement type (e.g., "groups")

**Example Output:** `Access Model Builder - Admin-VPN - ServiceNow - groups`

### Role Ownership

Three ownership models:

#### 1. Individual Owner
```json
{
  "roleOwnerType": "individual",
  "roleOwnerName": "spadmin"
}
```

#### 2. Source Owner
```json
{
  "roleOwnerType": "sourceOwner"
}
```
Uses the owner of the Auth Source.

#### 3. Governance Group
```json
{
  "roleOwnerType": "governance",
  "roleGovernanceGroupName": "Security Approvers"
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

### Access Request Configuration

```json
{
  "roleRequestable": true,
  "roleApprovers": ["owner", "manager"],
  "roleGovernanceGroupName": "Security Approvers",
  "roleAccessRequestCommentsRequired": true,
  "roleAccessRequestDenialCommentsRequired": true
}
```

### Revocation Configuration

```json
{
  "roleRequireApprovalForRemoval": true,
  "roleRevocationApprovers": ["owner"],
  "roleRevocationGovernanceGroupName": "Security Approvers"
}
```

## Advanced Features

### Processing Type

Control how entitlements are processed:

```json
{
  "processingType": "parallel"  // or "serial"
}
```

- **`parallel`**: Process all sources concurrently (faster)
- **`serial`**: Process sources one at a time (safer for rate limits)

### Execution Limit

Limit the number of entitlements processed per source:

```json
{
  "executionLimit": 100
}
```

### Dry Run Mode

Test configurations without making changes:

```json
{
  "dryRun": true
}
```

### Role Creation Style

Control when roles are created based on target source availability:

```json
{
  "roleCreationStyle": "all"  // or "any"
}
```

- **`any`** (default): Create role if entitlement exists in ANY target source
- **`all`**: Create role only if entitlement exists in ALL target sources

### Manual Override

Prevent automatic updates to specific roles using metadata attribute:

**How it works:**
1. The connector creates a metadata attribute called `uam_manual_override` (if it doesn't exist)
2. Add this attribute to any role you want to protect from automatic updates
3. Set the value to `true`
4. The connector will skip all updates for that role

**Use Cases:**
- Manually customized roles that shouldn't be overwritten
- Roles under review or pending approval
- Temporary protection during troubleshooting

**Steps:**
1. In ISC, go to the Role
2. Add metadata attribute: `uam_manual_override`
3. Set value: `true`
4. Save the role

The connector will log: `Role has manual override enabled. Skipping updates.`

### Advanced Filtering

Combine multiple filtering methods for precise entitlement selection:

#### 1. Glob Pattern Filtering

**Include Patterns** - Only sync entitlements matching these patterns:
```json
{
  "includePatterns": ["Admin-*", "*-VPN", "Prod-*"]
}
```

**Exclude Patterns** - Skip entitlements matching these patterns:
```json
{
  "excludePatterns": ["Test-*", "*_OLD", "Temp-*"]
}
```

**Glob Syntax:**
- `*` - Matches any characters (e.g., `Admin-*` matches `Admin-VPN`, `Admin-Finance`)
- `?` - Matches single character (e.g., `V?N` matches `VPN`, `VAN`)
- `[abc]` - Matches any character in brackets (e.g., `[Aa]dmin` matches `Admin` or `admin`)

#### 2. Native ISC API Filtering

Use ISC's native filter syntax for advanced queries:

```json
{
  "nativeFilter": "name sw \"Prod\" and type eq \"group\""
}
```

**Common Filters:**
- `name sw "Admin"` - Name starts with "Admin"
- `name ew "VPN"` - Name ends with "VPN"
- `name co "Finance"` - Name contains "Finance"
- `type eq "group"` - Type equals "group"
- `created gt "2024-01-01"` - Created after date

**Combining Filters:**
```json
{
  "nativeFilter": "name sw \"Prod\" and type eq \"group\" and created gt \"2024-01-01\""
}
```

#### 3. Filter Combination Logic

When multiple filters are used:
1. **Native Filter** is applied first (at API level)
2. **Include Patterns** are applied next (only matching items pass)
3. **Exclude Patterns** are applied last (matching items are removed)

**Example:**
```json
{
  "nativeFilter": "type eq \"group\"",
  "includePatterns": ["Prod-*", "Admin-*"],
  "excludePatterns": ["*-Test", "*_OLD"]
}
```

This will:
1. Get only entitlements where `type eq "group"`
2. Keep only those starting with "Prod-" or "Admin-"
3. Remove any ending with "-Test" or "_OLD"

### Segment Assignment

Automatically assign roles to segments for better organization and governance:

```json
{
  "roleSegmentNames": ["Austin Employees", "IT Department", "VPN Users"]
}
```

**Requirements:**
- Segments must already exist in ISC
- Segment names are case-sensitive
- Multiple segments can be assigned

**Use Cases:**
- Organize roles by department, location, or function
- Apply segment-specific governance policies
- Enable segment-based reporting and analytics

### Governance Group Integration

Use Governance Groups for approval workflows:

```json
{
  "roleGovernanceGroupName": "Security Approvers",
  "roleRevocationGovernanceGroupName": "Access Review Team"
}
```

**Access Request Approvals:**
- Governance Group members can approve/deny access requests
- Combines with other approvers (owner, manager)

**Revocation Approvals:**
- Separate Governance Group for revocation workflows
- Useful for compliance and audit requirements

## Complete Examples

### Example 1: Basic ServiceNow to Okta Sync

```json
{
  "baseurl": "https://tenant.api.identitynow.com",
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
      "roleNameTemplate": "Access Model Builder - ${_value} - SNOW",
      "roleOwnerType": "individual",
      "roleOwnerName": "spadmin",
      "roleMembershipCriteria": "identity.department eq \"$_value\""
    },
    {
      "sourceName": "Active Directory",
      "entitlementTypes": ["group"],
      "roleCreation": true,
      "roleNameTemplate": "Access Model Builder - ${_value} - AD",
      "roleOwnerType": "source",
      "roleMembershipCriteria": "'Active Directory'.attribute.employeeType eq \"FTE\" and identity.cloudLifecycleState eq \"active\""
    }
  ],
  "targetSources": [
    {
      "sourceName": "Okta",
      "standard": true,
      "workflowName": "Access Model Builder - Okta Create Entitlements",
      "workflowId": "okta-workflow-id",
      "workflowClientId": "okta-workflow-client-id",
      "workflowClientSecret": "okta-workflow-client-secret"
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

### Example 6: Full Access Model (AP + Roles)

```json
{
  "baseurl": "https://tenant.api.identitynow.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "dryRun": false,
  "executionLimit": 100,
  "processingType": "parallel",
  "workflowId": "global-workflow-id",
  "workflowClientId": "workflow-client-id",
  "workflowClientSecret": "workflow-secret",
  "entitlementSources": [
    {
      "sourceName": "ServiceNow",
      "entitlementTypes": ["roles", "groups"],
      "enableFiltering": true,
      "includePatterns": ["*-VPN", "Admin-*"],
      "excludePatterns": ["Test-*", "*_OLD"],
      "nativeFilter": "name sw \"A\"",
      "accessProfileCreation": true,
      "accessProfileNameTemplate": "AP - ${_value}",
      "accessProfileOwnerType": "individual",
      "accessProfileOwnerName": "spadmin",
      "accessProfileEnabled": true,
      "accessProfileRequestable": false,
      "roleCreation": true,
      "roleNameTemplate": "Access Model Builder - ${_value} - ${_source} - ${_type}",
      "roleEnabled": true,
      "roleRequestable": true,
      "roleOwnerType": "individual",
      "roleOwnerName": "spadmin",
      "roleCreationStyle": "any",
      "roleApprovers": ["owner", "manager"],
      "roleGovernanceGroupName": "Security Approvers",
      "roleSegmentNames": ["Austin Employees"],
      "roleMembershipCriteria": "identity.department eq \"IT\" and identity.location eq \"Austin\"",
      "roleAccessRequestCommentsRequired": true,
      "roleAccessRequestDenialCommentsRequired": true,
      "roleRequireApprovalForRemoval": true,
      "roleRevocationApprovers": ["owner"],
      "roleRevocationGovernanceGroupName": "Security Approvers"
    }
  ],
  "targetSources": [
    {
      "sourceName": "Okta",
      "standard": true,
      "workflowName": "Access Model Builder - Okta Create Entitlements",
      "workflowId": "okta-workflow-id",
      "workflowClientId": "okta-workflow-client-id",
      "workflowClientSecret": "okta-workflow-client-secret"
    },
    {
      "sourceName": "Azure AD",
      "standard": false
    }
  ]
}
```

## Troubleshooting

### Common Issues

#### 1. Roles/Access Profiles Not Created

**Possible Causes:**
- Entitlement doesn't exist in target source (validation failed)
- `dryRun` mode is enabled
- Execution limit reached
- Filtering excluded the entitlement

**Solution:**
- Check logs for validation messages
- Verify entitlement exists in target source
- Disable `dryRun` mode
- Increase `executionLimit`
- Review filter patterns

#### 2. Workflow Execution Failed

**Possible Causes:**
- Invalid workflow credentials
- Workflow ID incorrect
- Workflow not enabled

**Solution:**
- Verify `workflowClientId` and `workflowClientSecret`
- Check workflow ID in ISC
- Ensure workflow is enabled

#### 3. Role Updates Not Applied

**Possible Causes:**
- Manual override metadata attribute set
- No actual changes detected (delta detection)

**Solution:**
- Check if role has `uam_manual_override` metadata set to `true`
- Verify changes are meaningful (not just whitespace)

#### 4. Membership Criteria Not Working

**Common Mistakes:**
- ❌ `identity.attribute.department` (wrong - extra `attribute`)
- ✅ `identity.department` (correct)
- ❌ `Active Directory.attribute.foo` (wrong - missing quotes)
- ✅ `'Active Directory'.attribute.foo` (correct)

**Verify Syntax:**
- Check format documentation
- Use simple criteria first, then add complexity
- Test with dry run mode

#### 5. Filtering Not Working

**Glob Patterns:**
- Use `*` for wildcards
- Patterns are case-sensitive
- Test patterns individually

**Native Filters:**
- Use source-specific syntax
- Check source API documentation
- Verify filter in source UI first

#### 6. Performance Issues

**Solutions:**
- Reduce `executionLimit`
- Use `sequential` processing
- Add more specific filters
- Enable filtering to reduce entitlements processed

### Debug Mode

Enable debug logging in ISC source configuration to see detailed logs.

### Logging

The connector provides detailed logging:

```
{"level":"INFO","message":"Streaming entitlements from source: ServiceNow"}
{"level":"INFO","message":"Source ServiceNow has 150 total entitlements matching filter"}
{"level":"INFO","message":"Checking existence of Role: Access Model Builder - Admin-VPN - SNOW"}
{"level":"INFO","message":"Role created successfully: Access Model Builder - Admin-VPN - SNOW"}
{"level":"INFO","message":"Workflow triggered successfully for entitlement admin-vpn"}
```

**Log Levels:**
- `INFO` - Normal operations
- `WARN` - Non-critical issues
- `ERROR` - Failures requiring attention
- `DEBUG` - Detailed diagnostic information

## Best Practices

1. **Start with Dry Run**
   - Always test new configurations with `dryRun: true`
   - Use small `executionLimit` for testing

2. **Use Specific Filters**
   - Combine native filters with glob patterns
   - Filter at the source when possible (better performance)

## Additional Resources

- [SailPoint ISC Documentation](https://documentation.sailpoint.com/)
- [Velocity Template Language](https://velocity.apache.org/engine/devel/user-guide.html)
- [SCIM Filter Syntax](https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2)
- [Role Membership Criteria Format](https://github.com/yannick-beot-sp/vscode-sailpoint-identitynow?tab=readme-ov-file#roles)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or pull request.

## Author

Pavankalyan Dosa

