// ACR (Basic) for the snapshot pipeline's container image.

@description('ACR name — must be globally unique, alphanumeric, 5–50 chars.')
param registryName string

@description('Azure region.')
param location string

@description('SKU (default: Basic — cheapest tier, plenty for one image).')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param sku string = 'Basic'

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: registryName
  location: location
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false // Never enable admin user; use managed identity + AcrPull role instead.
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
  }
}

output registryId string = registry.id
output registryName string = registry.name
output loginServer string = registry.properties.loginServer
