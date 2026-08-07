// RBAC for the Container App's system-assigned identity.
//
// Grants:
//   - AcrPull on the ACR (pull the container image)
//   - Storage Blob Data Reader on `uploads` container (read source files)
//   - Storage Blob Data Contributor on `snapshots` container
//     (write JSON + history + manifest + idempotency marker)
//
// All scopes are container-level where possible (least privilege). The
// AcrPull scope is registry-level because ACR RBAC doesn't split further.

targetScope = 'resourceGroup'

@description('Principal ID (object ID) of the Container App system-assigned identity.')
param appPrincipalId string

@description('Full ACR resource ID.')
param registryId string

@description('Storage account ID (parent of the containers).')
param storageAccountId string

@description('Uploads container name.')
param uploadsContainerName string = 'uploads'

@description('Snapshots container name.')
param snapshotsContainerName string = 'snapshots'

// Role definition IDs (Azure built-in, stable across all tenants).
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  storageBlobDataReader: '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

// ── ACR pull ────────────────────────────────────────────────────────────
resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: last(split(registryId, '/'))
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, appPrincipalId, roles.acrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Storage: uploads (read) and snapshots (write) ───────────────────────
// The Container App identity gets least-privilege scopes on individual
// containers, not the whole storage account.

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: last(split(storageAccountId, '/'))
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource uploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobService
  name: uploadsContainerName
}

resource snapshotsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobService
  name: snapshotsContainerName
}

resource uploadsReaderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: uploadsContainer
  name: guid(uploadsContainer.id, appPrincipalId, roles.storageBlobDataReader)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataReader)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource snapshotsContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: snapshotsContainer
  name: guid(snapshotsContainer.id, appPrincipalId, roles.storageBlobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}
