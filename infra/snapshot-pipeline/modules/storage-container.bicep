// Creates the private `snapshots` blob container on an existing storage account
// and enables 14-day soft-delete on both blob-level and container-level so that
// mistakes during pipeline dev are recoverable.
//
// Idempotent: rerunning this module against an already-configured account is
// a no-op.

@description('Name of the existing storage account (e.g. stafnfhauploads).')
param storageAccountName string

@description('Name of the container to create (default: snapshots).')
param containerName string = 'snapshots'

@description('Blob soft-delete retention in days (default: 14).')
@minValue(1)
@maxValue(365)
param softDeleteRetentionDays int = 14

// Reference the existing storage account (must already exist).
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// Enable soft-delete for blobs and containers on the account's blob service.
// This is scoped to the whole account (all containers), but that's fine — the
// `uploads` container also benefits from it as a bonus.
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteRetentionDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: softDeleteRetentionDays
    }
  }
}

// Create the private `snapshots` container. No anonymous access.
resource snapshotsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'automated-fha-snapshots'
      owner: 'fha-risk-monitor'
    }
  }
}

output containerId string = snapshotsContainer.id
output containerName string = snapshotsContainer.name
output storageAccountId string = storageAccount.id
