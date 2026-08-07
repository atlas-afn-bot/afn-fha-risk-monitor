// Log Analytics workspace + Application Insights (workspace-based) for the
// snapshot pipeline. Both required inputs for the Container Apps managed
// environment. Also drives the audit-trail queries described in the design doc.

@description('Workspace name (e.g. log-fha-snapshot-pipeline).')
param workspaceName string

@description('Application Insights component name (e.g. ai-fha-snapshot-pipeline).')
param appInsightsName string

@description('Azure region.')
param location string

@description('Log retention in days (default: 90). Cheap tier.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output workspaceCustomerId string = workspace.properties.customerId
output appInsightsId string = appInsights.id
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
