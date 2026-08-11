// Container Apps managed environment + the snapshot-builder app itself.
//
// The app is:
//   - single-replica, scale-to-zero (minReplicas 0, maxReplicas 1)
//   - system-assigned managed identity (used to pull image from ACR and to
//     read/write storage)
//   - HTTP-triggered (external ingress) so we can POST an Event Grid payload
//     (or a manual curl during Phase 1) to kick off a build
//
// Bicep resolves image → identity → env dependencies automatically. First
// deployment uses a placeholder image (imageOverride param) because you
// can't push to ACR until ACR exists. See the parent README for the two-step
// bring-up procedure.

@description('Container Apps managed environment name.')
param environmentName string

@description('Container App name (e.g. fha-snapshot-builder).')
param appName string

@description('Azure region.')
param location string

@description('Log Analytics workspace customer ID (from log-analytics module).')
param logAnalyticsCustomerId string

@description('Log Analytics workspace primary shared key (from log-analytics module).')
@secure()
param logAnalyticsSharedKey string

@description('Application Insights connection string.')
@secure()
param appInsightsConnectionString string

@description('Full image reference (e.g. crafnfhapipeline.azurecr.io/snapshot-builder:v1). Use the placeholder for first-time bring-up.')
param image string

@description('ACR login server (used to configure the registry credential via identity).')
param acrLoginServer string

@description('Storage account name (passed to container as env var).')
param storageAccountName string

@description('Uploads container name.')
param uploadsContainerName string = 'uploads'

@description('Snapshots container name.')
param snapshotsContainerName string = 'snapshots'

@description('Shared-secret header value the app requires on the trigger endpoint. Rotate periodically.')
@secure()
param triggerSharedSecret string

@description('Azure OpenAI endpoint for AI insight generation (public HTTPS).')
param azureOpenAIEndpoint string

@description('Azure OpenAI deployment name used for AI insights (NOT the underlying model name).')
param azureOpenAIDeployment string

@description('Azure OpenAI REST API version, e.g. 2025-01-01-preview.')
param azureOpenAIApiVersion string = '2025-01-01-preview'

@description('Azure OpenAI API key (stored as a Container App secret).')
@secure()
param azureOpenAIApiKey string

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    zoneRedundant: false
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
      secrets: [
        {
          name: 'appinsights-connection-string'
          value: appInsightsConnectionString
        }
        {
          name: 'trigger-shared-secret'
          value: triggerSharedSecret
        }
        {
          name: 'azure-openai-api-key'
          value: azureOpenAIApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'snapshot-builder'
          image: image
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'appinsights-connection-string'
            }
            {
              name: 'TRIGGER_SHARED_SECRET'
              secretRef: 'trigger-shared-secret'
            }
            {
              name: 'STORAGE_ACCOUNT_NAME'
              value: storageAccountName
            }
            {
              name: 'UPLOADS_CONTAINER'
              value: uploadsContainerName
            }
            {
              name: 'SNAPSHOTS_CONTAINER'
              value: snapshotsContainerName
            }
            {
              name: 'PYTHONUNBUFFERED'
              value: '1'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenAIEndpoint
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT'
              value: azureOpenAIDeployment
            }
            {
              name: 'AZURE_OPENAI_API_VERSION'
              value: azureOpenAIApiVersion
            }
            {
              name: 'AZURE_OPENAI_API_KEY'
              secretRef: 'azure-openai-api-key'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output appId string = app.id
output appPrincipalId string = app.identity.principalId
output appFqdn string = app.properties.configuration.ingress.fqdn
output appName string = app.name
