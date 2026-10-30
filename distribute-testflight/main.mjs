import { createSign } from 'node:crypto'

const requiredEnv = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`environment variable ${name} is required`)
  return value
}

const bundleId = requiredEnv('BUNDLE_ID')
const appVersion = requiredEnv('APP_VERSION')
const buildNumber = requiredEnv('BUILD_NUMBER')
const betaGroupNames = JSON.parse(requiredEnv('BETA_GROUPS'))
const whatsNew = process.env.WHATS_NEW || ''
const whatsNewLocale = process.env.WHATS_NEW_LOCALE || 'ja'
const autoNotify = process.env.AUTO_NOTIFY === 'true'
const processingTimeoutMs = Number(process.env.PROCESSING_TIMEOUT_MINUTES || '60') * 60 * 1000
const pollIntervalMs = 30 * 1000

if (!betaGroupNames.length) throw new Error('beta_groups is empty')

const base64Url = (input) => Buffer.from(input).toString('base64url')

const token = () => {
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

const request = async (method, path, body) => {
  const headers = { authorization: `Bearer ${token()}` }
  if (body) headers['content-type'] = 'application/json'

  const res = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

const query = (params) => new URLSearchParams(params).toString()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const findAppId = async () => {
  const apps = await request('GET', `/apps?${query({ 'filter[bundleId]': bundleId })}`)
  if (!apps.data?.length) throw new Error(`App Store Connect app not found: ${bundleId}`)
  return apps.data[0].id
}

const waitForProcessedBuild = async (appId) => {
  const deadline = Date.now() + processingTimeoutMs

  while (true) {
    const res = await request('GET', `/builds?${query({
      'filter[app]': appId,
      'filter[version]': buildNumber,
      'filter[preReleaseVersion.version]': appVersion,
      'filter[preReleaseVersion.platform]': 'IOS',
      include: 'buildBetaDetail',
      limit: '1',
    })}`)
    const build = res.data?.[0]

    if (build) {
      const processingState = build.attributes.processingState
      if (processingState === 'FAILED' || processingState === 'INVALID') {
        throw new Error(`build processing failed: ${processingState}`)
      }

      const detail = res.included?.find((resource) => resource.type === 'buildBetaDetails')
      const { internalBuildState, externalBuildState } = detail?.attributes ?? {}
      console.log(`processingState: ${processingState}, internalBuildState: ${internalBuildState}, externalBuildState: ${externalBuildState}`)

      if (processingState === 'VALID' && detail && internalBuildState !== 'PROCESSING' && externalBuildState !== 'PROCESSING') {
        return { build, detail }
      }
    } else {
      console.log(`build ${appVersion} (${buildNumber}) not found yet`)
    }

    if (Date.now() > deadline) throw new Error('timed out waiting for build processing')
    await sleep(pollIntervalMs)
  }
}

const updateWhatsNew = async (buildId) => {
  const localizations = await request('GET', `/betaBuildLocalizations?${query({ 'filter[build]': buildId })}`)

  if (localizations.data?.length) {
    for (const localization of localizations.data) {
      await request('PATCH', `/betaBuildLocalizations/${localization.id}`, {
        data: { type: 'betaBuildLocalizations', id: localization.id, attributes: { whatsNew } },
      })
    }
    return
  }

  await request('POST', '/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { whatsNew, locale: whatsNewLocale },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  })
}

const findBetaGroups = async (appId) => {
  const res = await request('GET', `/betaGroups?${query({
    'filter[app]': appId,
    'filter[name]': betaGroupNames.join(','),
    'filter[isInternalGroup]': 'false',
    limit: '200',
  })}`)
  const groups = (res.data ?? []).filter((group) => !group.attributes.isInternalGroup && betaGroupNames.includes(group.attributes.name))

  const missing = betaGroupNames.filter((name) => !groups.some((group) => group.attributes.name === name))
  if (missing.length) throw new Error(`external beta groups not found: ${missing.join(', ')}`)

  return groups
}

const appId = await findAppId()
const groups = await findBetaGroups(appId)
const { build, detail } = await waitForProcessedBuild(appId)

if (detail.attributes.externalBuildState === 'MISSING_EXPORT_COMPLIANCE') {
  throw new Error('export compliance is missing. Set ITSAppUsesNonExemptEncryption in Info.plist')
}

if (whatsNew) {
  await updateWhatsNew(build.id)
  console.log('updated whats new')
}

if (autoNotify) {
  await request('PATCH', `/buildBetaDetails/${detail.id}`, {
    data: { type: 'buildBetaDetails', id: detail.id, attributes: { autoNotifyEnabled: true } },
  })
  console.log('enabled auto notify')
}

if (detail.attributes.externalBuildState !== 'READY_FOR_BETA_SUBMISSION') {
  throw new Error(`build is not ready for beta review submission: ${detail.attributes.externalBuildState}`)
}

await request('POST', '/betaAppReviewSubmissions', {
  data: {
    type: 'betaAppReviewSubmissions',
    relationships: { build: { data: { type: 'builds', id: build.id } } },
  },
})
console.log('submitted for beta review')

await request('POST', `/builds/${build.id}/relationships/betaGroups`, {
  data: groups.map((group) => ({ type: 'betaGroups', id: group.id })),
})
console.log(`added to beta groups: ${betaGroupNames.join(', ')}`)
