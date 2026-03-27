import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/**
 * 供本地浏览器读取 ~/.openclaw 中的 gateway/device token，完成 WebSocket 握手。
 * 必须在 Vite dev 或 vite preview 下访问前端（同源），直接打开 dist 或静态托管则无此路由。
 */
function attachOpenClawLocalMiddleware(
  middlewares: ViteDevServer['middlewares'] | PreviewServer['middlewares'],
) {
  middlewares.use('/__openclaw_device_auth', (_req, res) => {
    try {
      const home = os.homedir()
      const openclawConfigPath = path.join(home, '.openclaw', 'openclaw.json')
      const raw = fs.readFileSync(openclawConfigPath, 'utf8')
      const parsed = JSON.parse(raw) as any
      const gatewayToken = parsed?.gateway?.auth?.token
      if (typeof gatewayToken !== 'string') {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'gateway auth token missing' }))
        return
      }
      const deviceAuthPath = path.join(home, '.openclaw', 'identity', 'device-auth.json')
      const deviceRaw = fs.readFileSync(deviceAuthPath, 'utf8')
      const deviceParsed = JSON.parse(deviceRaw) as any
      const deviceToken = deviceParsed?.tokens?.operator?.token
      if (typeof deviceToken !== 'string') {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'device auth token missing' }))
        return
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ gatewayToken, deviceToken }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
  })

  middlewares.use('/__openclaw_device_identity', (req, res) => {
    try {
      const home = os.homedir()
      const deviceJsonPath = path.join(home, '.openclaw', 'identity', 'device.json')
      const rawIdentity = fs.readFileSync(deviceJsonPath, 'utf8')
      const identityParsed = JSON.parse(rawIdentity) as any
      const deviceId = identityParsed?.deviceId
      const publicKeyPem = identityParsed?.publicKeyPem
      const privateKeyPem = identityParsed?.privateKeyPem
      if (typeof deviceId !== 'string' || typeof publicKeyPem !== 'string' || typeof privateKeyPem !== 'string') {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'identity device.json missing fields' }))
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      const nonce = url.searchParams.get('nonce') ?? ''
      const token = url.searchParams.get('token') ?? ''
      const clientId = url.searchParams.get('clientId') ?? ''
      const clientMode = url.searchParams.get('clientMode') ?? ''
      const role = url.searchParams.get('role') ?? ''
      const platform = url.searchParams.get('platform') ?? ''
      const deviceFamily = url.searchParams.get('deviceFamily') ?? ''
      const scopesCsv = url.searchParams.get('scopes') ?? ''
      const signedAtMsStr = url.searchParams.get('signedAtMs') ?? ''

      const signedAtMs = Number(signedAtMsStr)
      const scopes = scopesCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      if (!nonce || !clientId || !clientMode || !role || !Number.isFinite(signedAtMs)) {
        res.statusCode = 400
        res.end(
          JSON.stringify({
            error: 'missing required params (nonce/clientId/clientMode/role/signedAtMs)',
          }),
        )
        return
      }

      const platformNorm = String(platform).trim().toLowerCase()
      const deviceFamilyNorm = String(deviceFamily).trim().toLowerCase()
      const scopesStr = scopes.join(',')

      const payload = [
        'v3',
        deviceId,
        clientId,
        clientMode,
        role,
        scopesStr,
        String(signedAtMs),
        token ?? '',
        nonce,
        platformNorm,
        deviceFamilyNorm,
      ].join('|')

      const key = crypto.createPrivateKey(privateKeyPem)
      const signatureBuf = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
      const signatureB64 = signatureBuf.toString('base64')
      const signature = signatureB64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')

      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          device: {
            id: deviceId,
            publicKey: publicKeyPem,
            signature,
            signedAt: signedAtMs,
            nonce,
          },
        }),
      )
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'openclaw-device-auth-local-endpoint',
      configureServer(server) {
        attachOpenClawLocalMiddleware(server.middlewares)
      },
      configurePreviewServer(server) {
        attachOpenClawLocalMiddleware(server.middlewares)
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    proxy: {
      // IdeaShu Sync 服务代理
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true, // 支持 WebSocket
      },
    },
  },
  preview: {
    host: '127.0.0.1',
  },
})
