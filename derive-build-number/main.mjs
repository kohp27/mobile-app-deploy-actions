import { createSign } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const iosApps = JSON.parse(process.env.IOS_APPS || '[]')
const androidApps = JSON.parse(process.env.ANDROID_APPS || '[]')

const requiredEnv = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`environment variable ${name} is required`)
  return value
}

const base64Url = (input) => Buffer.from(input).toString('base64url')

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: ${res.status} ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

const androidAccessToken = async (serviceAccount) => {
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token'
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))

  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 600,
  }))

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)

  const jwt = `${header}.${payload}.${signer.sign(serviceAccount.private_key).toString('base64url')}`
  const res = await fetchJson(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })

  return res.access_token
}

const androidMaxVersionCode = async (token, packageName) => {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`
  const edit = await fetchJson(`${base}/edits`, { method: 'POST', headers, body: '{}' })

  try {
    const [bundles, apks] = await Promise.all([
      fetchJson(`${base}/edits/${edit.id}/bundles`, { headers }),
      fetchJson(`${base}/edits/${edit.id}/apks`, { headers }),
    ])
    const codes = [...(bundles.bundles ?? []), ...(apks.apks ?? [])]
      .map((artifact) => Number(artifact.versionCode))
      .filter(Number.isFinite)
    return codes.length ? Math.max(...codes) : 0
  } finally {
    await fetch(`${base}/edits/${edit.id}`, { method: 'DELETE', headers }).catch(() => { })
  }
}

const iosToken = () => {
  const keyId = requiredEnv('APP_STORE_CONNECT_KEY_ID')
  const issuerId = requiredEnv('APP_STORE_CONNECT_ISSUER_ID')
  const privateKey = requiredEnv('APP_STORE_CONNECT_PRIVATE_KEY')
  const now = Math.floor(Date.now() / 1000)

  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))

  const payload = base64Url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }))
  const signer = createSign('SHA256')
  signer.update(`${header}.${payload}`)

  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })

  return `${header}.${payload}.${signature.toString('base64url')}`
}

const iosMaxBuildNumber = async (token, bundleId) => {
  const headers = { authorization: `Bearer ${token}` }
  const apps = await fetchJson(
    `https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(bundleId)}`,
    { headers },
  )
  if (!apps.data?.length) throw new Error(`App Store Connect app not found: ${bundleId}`)

  const builds = await fetchJson(
    `https://api.appstoreconnect.apple.com/v1/builds?filter%5Bapp%5D=${apps.data[0].id}&sort=-uploadedDate&limit=200`,
    { headers },
  )

  return (builds.data ?? []).reduce((max, build) => {
    const version = Number(build.attributes?.version)
    return Number.isFinite(version) ? Math.max(max, version) : max
  }, 0)
}

const collectAndroidMaxBuildNumbers = async () => {
  if (!androidApps.length) return []

  const serviceAccount = JSON.parse(requiredEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'))
  const token = await androidAccessToken(serviceAccount)
  const results = []

  for (const packageName of androidApps) {
    results.push({ platform: 'Android', appId: packageName, maxBuildNumber: await androidMaxVersionCode(token, packageName) })
  }

  return results
}

const collectIosMaxBuildNumbers = async () => {
  if (!iosApps.length) return []

  const token = iosToken()
  const results = []

  for (const bundleId of iosApps) {
    results.push({ platform: 'iOS', appId: bundleId, maxBuildNumber: await iosMaxBuildNumber(token, bundleId) })
  }

  return results
}


if (!androidApps.length && !iosApps.length) {
  throw new Error('ios_apps and android_apps are both empty')
}

const results = [
  ...(await collectAndroidMaxBuildNumbers()),
  ...(await collectIosMaxBuildNumbers()),
]

for (const { platform, appId, maxBuildNumber } of results) {
  console.log(`${platform} ${appId}: ${maxBuildNumber}`)
}

const maxBuildNumber = Math.max(...results.map((result) => result.maxBuildNumber))
const nextBuildNumber = maxBuildNumber + 1
console.log(`max_build_number: ${maxBuildNumber}`)
console.log(`next_build_number: ${nextBuildNumber}`)

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `max_build_number=${maxBuildNumber}\nnext_build_number=${nextBuildNumber}\n`)
}
