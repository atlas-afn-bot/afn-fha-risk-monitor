// Snapshot pipeline — orchestrating Bicep template.
//
// Deploys, in dependency order:
//   1. Log Analytics workspace + Application Insights
//   2. ACR
//   3. Private `snapshots` blob container (+ blob soft-delete on the account)
//   4. Container Apps managed environment + `fha-snapshot-builder` app
//   5. RBAC: identity → ACR + storage containers
//
// The Container App is created with a placeholder image on first-time
// bring-up because ACR is empty. Push the real image, then re-run this
// template with the real `imageTag` param.

targetScope = 'resourceGroup'

@description('Azure region — must match the storage account.')
param location string = resourceGroup().location

@description('Existing storage account name.')
param storageAccountName string

@description('Uploads container name (must already exist).')
param uploadsContainerName string = 'uploads'

@description('Snapshots container name (created by this template).')
param snapshotsContainerName string = 'snapshots'

@description('Log Analytics workspace name.')
param logWorkspaceName string = 'log-fha-snapshot-pipeline'

@description('Application Insights component name.')
param appInsightsName string = 'ai-fha-snapshot-pipeline'

@description('ACR name (globally unique, alphanumeric).')
param acrName string

@description('Container Apps managed environment name.')
param containerEnvName string = 'cae-fha-snapshot-pipeline'

@description('Container App name.')
param containerAppName string = 'fha-snapshot-builder'

@description('Container image reference. On first bring-up leave this at the placeholder; after the real image is pushed, redeploy with acr-name.azurecr.io/snapshot-builder:v1.')
param image string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Shared secret required on the trigger HTTP endpoint. Rotate periodically.')
@secure()
param triggerSharedSecret string

@description('Azure OpenAI endpoint for AI insight generation (e.g. https://brady-wu-ai.cognitiveservices.azure.com/).')
param azureOpenAIEndpoint string

@description('Azure OpenAI deployment name (NOT the underlying model name) used for AI insights.')
param azureOpenAIDeployment string

@description('Azure OpenAI REST API version, e.g. 2025-01-01-preview.')
param azureOpenAIApiVersion string = '2025-01-01-preview'

@description('Azure OpenAI API key (secret). Supply via `--parameters azureOpenAIApiKey=<value>` or Key Vault reference.')
@secure()
param azureOpenAIApiKey string

// ── Step 1: Log Analytics + App Insights ────────────────────────────────
module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'logAnalyticsDeploy'
  params: {
    workspaceName: logWorkspaceName
    appInsightsName: appInsightsName
    location: location
  }
}

// ── Step 2: ACR ─────────────────────────────────────────────────────────
module registry 'modules/container-registry.bicep' = {
  name: 'registryDeploy'
  params: {
    registryName: acrName
    location: location
  }
}

// ── Step 3: `snapshots` container + soft-delete ─────────────────────────
module storageContainer 'modules/storage-container.bicep' = {
  name: 'storageContainerDeploy'
  params: {
    storageAccountName: storageAccountName
    containerName: snapshotsContainerName
  }
}

// ── Step 4: Container Apps managed env + app ────────────────────────────
// Fetch the workspace shared key at the call site so we don't have to output
// a secret from the log-analytics module (Bicep linter would flag it).
resource logWorkspaceRef 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logWorkspaceName
  dependsOn: [
    logAnalytics
  ]
}

module containerApp 'modules/container-app.bicep' = {
  name: 'containerAppDeploy'
  params: {
    environmentName: containerEnvName
    appName: containerAppName
    location: location
    logAnalyticsCustomerId: logAnalytics.outputs.workspaceCustomerId
    logAnalyticsSharedKey: logWorkspaceRef.listKeys().primarySharedKey
    appInsightsConnectionString: logAnalytics.outputs.appInsightsConnectionString
    image: image
    acrLoginServer: registry.outputs.loginServer
    storageAccountName: storageAccountName
    uploadsContainerName: uploadsContainerName
    snapshotsContainerName: snapshotsContainerName
    triggerSharedSecret: triggerSharedSecret
    azureOpenAIEndpoint: azureOpenAIEndpoint
    azureOpenAIDeployment: azureOpenAIDeployment
    azureOpenAIApiVersion: azureOpenAIApiVersion
    azureOpenAIApiKey: azureOpenAIApiKey
  }
  dependsOn: [
    storageContainer
  ]
}

// ── Step 5: RBAC ────────────────────────────────────────────────────────
module rbac 'modules/role-assignments.bicep' = {
  name: 'rbacDeploy'
  params: {
    appPrincipalId: containerApp.outputs.appPrincipalId
    registryId: registry.outputs.registryId
    storageAccountId: storageContainer.outputs.storageAccountId
    uploadsContainerName: uploadsContainerName
    snapshotsContainerName: snapshotsContainerName
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────
output containerAppFqdn string = containerApp.outputs.appFqdn
output containerAppName string = containerApp.outputs.appName
output containerAppPrincipalId string = containerApp.outputs.appPrincipalId
output acrLoginServer string = registry.outputs.loginServer
output appInsightsName string = appInsightsName
output snapshotsContainer string = storageContainer.outputs.containerName
