const API_ROOT = '/api/v5'

function cloudConfig() {
  const { MQTT_CLOUD_API_URL, MQTT_CLOUD_APP_ID, MQTT_CLOUD_APP_SECRET } = process.env
  if (!MQTT_CLOUD_API_URL || !MQTT_CLOUD_APP_ID || !MQTT_CLOUD_APP_SECRET) {
    throw new Error('Konfigurasi MQTT Cloud API belum lengkap. Isi MQTT_CLOUD_API_URL, MQTT_CLOUD_APP_ID, dan MQTT_CLOUD_APP_SECRET.')
  }
  return {
    baseUrl: MQTT_CLOUD_API_URL.replace(/\/$/, ''),
    authorization: `Basic ${Buffer.from(`${MQTT_CLOUD_APP_ID}:${MQTT_CLOUD_APP_SECRET}`).toString('base64')}`,
  }
}

async function cloudRequest(path, { method = 'GET', body } = {}) {
  const { baseUrl, authorization } = cloudConfig()
  const response = await fetch(`${baseUrl}${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  })
  const responseText = await response.text()
  if (!response.ok) {
    const detail = responseText.slice(0, 500)
    const error = new Error(`EMQX Cloud API ${method} ${path} gagal (${response.status}): ${detail}`)
    error.status = response.status
    throw error
  }
  return responseText ? JSON.parse(responseText) : null
}

function deviceRules(deviceId) {
  const prefix = `lumacurtain/${deviceId}`
  return [
    { action: 'publish', permission: 'allow', topic: `${prefix}/telemetry`, qos: [0, 1], retain: 'false' },
    { action: 'publish', permission: 'allow', topic: `${prefix}/heartbeat`, qos: [0, 1], retain: 'false' },
    { action: 'publish', permission: 'allow', topic: `${prefix}/status`, qos: [0, 1], retain: 'false' },
    { action: 'subscribe', permission: 'allow', topic: `${prefix}/command`, qos: [0, 1] },
  ]
}

async function createCloudUser(deviceId, password) {
  await cloudRequest('/authentication/password_based:built_in_database/users', {
    method: 'POST',
    body: { user_id: deviceId, password, is_superuser: false },
  })
}

async function setDeviceRules(deviceId, createIfMissing = false) {
  const username = encodeURIComponent(deviceId)
  const path = `/authorization/sources/built_in_database/rules/users/${username}`
  const body = { username: deviceId, rules: deviceRules(deviceId) }
  try {
    await cloudRequest(path, { method: 'PUT', body })
  } catch (error) {
    if (error.status !== 404 || !createIfMissing) throw error
    await cloudRequest('/authorization/sources/built_in_database/rules/users', {
      method: 'POST',
      body: [{ username: deviceId, rules: deviceRules(deviceId) }],
    })
  }
}

export async function createDeviceMqttIdentity(deviceId, password) {
  await createCloudUser(deviceId, password)
  try {
    await setDeviceRules(deviceId, true)
  } catch (error) {
    try {
      await cloudRequest(`/authentication/password_based:built_in_database/users/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
    } catch {
      // Preserve the original provisioning error; clean up manually if the API is unavailable.
    }
    throw error
  }
}

export async function rotateDeviceMqttIdentity(deviceId, password) {
  const userPath = `/authentication/password_based:built_in_database/users/${encodeURIComponent(deviceId)}`
  try {
    await cloudRequest(userPath)
    await setDeviceRules(deviceId, true)
    await cloudRequest(userPath, { method: 'PUT', body: { password, is_superuser: false } })
  } catch (error) {
    if (error.status !== 404) throw error
    await createDeviceMqttIdentity(deviceId, password)
  }
}

export async function deleteDeviceMqttIdentity(deviceId) {
  const username = encodeURIComponent(deviceId)
  try {
    await cloudRequest(`/authorization/sources/built_in_database/rules/users/${username}`, { method: 'DELETE' })
  } catch (error) {
    if (error.status !== 404) throw error
  }
  try {
    await cloudRequest(`/authentication/password_based:built_in_database/users/${username}`, { method: 'DELETE' })
  } catch (error) {
    if (error.status !== 404) throw error
  }
}
