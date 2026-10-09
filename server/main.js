import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthHandlers, isSessionTokenValid, sessionTokenFromHandshake, userFromRequest } from './auth.js'
import { analyzeConversation, getModelStatus, setModelCachePath } from './analyzer.js'
import { parseImportBuffer } from './chat.js'
import { JsonStore } from './store.js'
import { summaryLanguages } from '../shared/languages.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT || 3001)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.')

const configuredDataDirectory = process.env.WHAT_DID_I_MISS_DATA_DIR?.trim()
const defaultDataDirectory = process.env.LOCALAPPDATA
  ? resolve(process.env.LOCALAPPDATA, 'WhatDidIMiss')
  : resolve(process.env.XDG_DATA_HOME || resolve(homedir(), '.local', 'share'), 'what-did-i-miss')
const localData = resolve(configuredDataDirectory || defaultDataDirectory)
const store = new JsonStore(resolve(localData, 'private-store.json'))
setModelCachePath(resolve(localData, 'models'))
const configuredWebOrigins = new Set(
  (process.env.WHAT_DID_I_MISS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const localWebOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
])

const app = express()
const server = createServer(app)
const io = new Server(server, {
  serveClient: false,
  maxHttpBufferSize: 1024 * 1024,
  cors: {
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || isAllowedOrigin(origin))
    },
  },
})
const auth = createAuthHandlers(store)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
})

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Cache-Control', request.path.startsWith('/api') ? 'no-store' : 'no-cache')
  next()
})

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function isAllowedOrigin(origin) {
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  if (isLoopbackHost(parsed.hostname) && localWebOrigins.has(origin)) return true
  return parsed.protocol === 'https:' && configuredWebOrigins.has(origin)
}

function corsAndOriginPolicy(request, response, next) {
  const origin = request.get('origin')
  if (!origin) return next()
  if (!isAllowedOrigin(origin)) {
    response.status(403).json({ error: 'This web origin is not configured for the local companion.' })
    return
  }
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Vary', 'Origin')
  if (request.get('access-control-request-private-network') === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }
  next()
}

app.use((request, response, next) => {
  const hostname = request.hostname
  if (!isLoopbackHost(hostname)) {
    response.status(403).json({ error: 'This private app only accepts requests from this device.' })
    return
  }
  next()
})
app.use('/api', corsAndOriginPolicy)
app.use('/socket.io', corsAndOriginPolicy)

function requireLocalOrigin(request, response, next) {
  const origin = request.get('origin')
  if (!origin) return next()
  if (!isAllowedOrigin(origin)) {
    response.status(403).json({ error: 'Request origin is not allowed.' })
    return
  }
  next()
}

function requireAuth(request, response, next) {
  const userId = userFromRequest(request)
  if (!userId) {
    response.status(401).json({ error: 'Sign in to continue.' })
    return
  }
  request.userId = userId
  next()
}

const authAttempts = new Map()
function limitAuthAttempts(request, response, next) {
  const now = Date.now()
  const client = request.socket.remoteAddress || 'loopback'
  const recent = (authAttempts.get(client) || []).filter((time) => now - time < 60_000)
  if (recent.length >= 10) {
    response.status(429).json({ error: 'Too many sign-in attempts. Wait a minute and try again.' })
    return
  }
  recent.push(now)
  authAttempts.set(client, recent)
  next()
}

function sendToUser(userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload)
}

app.get('/api/health', (request, response) => {
  response.json({
    status: 'ok',
    service: 'local',
    loopbackOnly: true,
    model: getModelStatus(),
  })
})

app.post('/api/auth/signup', requireLocalOrigin, limitAuthAttempts, (request, response, next) => auth.signup(request, response).catch(next))
app.post('/api/auth/login', requireLocalOrigin, limitAuthAttempts, (request, response, next) => auth.login(request, response).catch(next))
app.get('/api/auth/me', (request, response, next) => auth.me(request, response).catch(next))
app.post('/api/auth/logout', requireLocalOrigin, (request, response, next) => auth.logout(request, response).catch(next))

app.get('/api/model/status', requireAuth, (request, response) => response.json(getModelStatus()))

app.get('/api/conversations', requireAuth, async (request, response, next) => {
  try {
    const data = await store.read()
    const conversations = data.conversations
      .filter((conversation) => conversation.userId === request.userId)
      .map(({ id, title, createdAt, messageCount, status, report, warnings }) => ({
        id, title, createdAt, messageCount, status, report, warnings,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    response.json({ conversations })
  } catch (error) {
    next(error)
  }
})

app.get('/api/conversations/:conversationId', requireAuth, async (request, response, next) => {
  try {
    const conversation = (await store.read()).conversations.find((item) =>
      item.id === request.params.conversationId && item.userId === request.userId)
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' })
    response.json({ conversation })
  } catch (error) {
    next(error)
  }
})

app.get('/api/conversations/:conversationId/summary', requireAuth, async (request, response, next) => {
  try {
    const conversation = (await store.read()).conversations.find((item) =>
      item.id === request.params.conversationId && item.userId === request.userId)
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' })
    response.json({ summary: conversation.report?.summary ?? null, status: conversation.status, modelError: conversation.report?.modelError ?? null })
  } catch (error) {
    next(error)
  }
})

app.get('/api/conversations/:conversationId/highlights', requireAuth, async (request, response, next) => {
  try {
    const conversation = (await store.read()).conversations.find((item) =>
      item.id === request.params.conversationId && item.userId === request.userId)
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' })
    response.json({ highlights: conversation.report?.highlights ?? [], decisions: conversation.report?.decisions ?? [], deadlines: conversation.report?.deadlines ?? [], mentions: conversation.report?.mentions ?? [] })
  } catch (error) {
    next(error)
  }
})

app.get('/api/conversations/:conversationId/tasks', requireAuth, async (request, response, next) => {
  try {
    const conversation = (await store.read()).conversations.find((item) =>
      item.id === request.params.conversationId && item.userId === request.userId)
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' })
    response.json({ tasks: conversation.report?.tasks ?? [] })
  } catch (error) {
    next(error)
  }
})

app.post('/api/import', requireLocalOrigin, requireAuth, (request, response, next) => {
  upload.single('file')(request, response, async (uploadError) => {
    if (uploadError) return next(uploadError)
    try {
      if (!request.file) return response.status(400).json({ error: 'Choose a .txt, .csv, or .json conversation export.' })
      const parsed = await parseImportBuffer(request.file.buffer, request.file.originalname)
      if (parsed.messages.length > 25000) return response.status(413).json({ error: 'Import limit is 25,000 messages. Split the export into smaller files.' })
      const sourceLanguage = request.body?.sourceLanguage || 'eng_Latn'
      const summaryLanguage = request.body?.summaryLanguage || 'eng_Latn'
      if (![sourceLanguage, summaryLanguage].every((code) => summaryLanguages.some((language) => language.code === code && language.modelSupported !== false))) {
        return response.status(400).json({ error: 'Choose supported conversation and summary languages.' })
      }
      const conversation = {
        id: randomUUID(),
        userId: request.userId,
        title: request.file.originalname.replace(/\.(txt|csv|json)$/i, '').slice(0, 120) || 'Imported chat',
        createdAt: new Date().toISOString(),
        messageCount: parsed.messages.length,
        messages: parsed.messages,
        warnings: parsed.warnings,
        sourceLanguage,
        language: summaryLanguage,
        status: 'analyzing',
        report: null,
      }
      await store.update((data) => data.conversations.push(conversation))
      sendToUser(request.userId, 'conversation:status', { id: conversation.id, status: conversation.status })
      response.status(202).json({ conversation: { ...conversation, messages: undefined } })
      const user = (await store.read()).users.find((item) => item.id === request.userId)
      analyzeConversation(parsed.messages, user?.username || 'Sannidhi', io, request.userId, sourceLanguage, summaryLanguage).then(async (report) => {
        await store.update((data) => {
          const current = data.conversations.find((item) => item.id === conversation.id && item.userId === request.userId)
          if (!current) return
          current.report = report
          current.status = report.modelError ? 'summary_unavailable' : 'ready'
        })
        sendToUser(request.userId, 'conversation:ready', { id: conversation.id })
      }).catch((error) => {
        console.error('Local analysis failed.', error)
        store.update((data) => {
          const current = data.conversations.find((item) => item.id === conversation.id && item.userId === request.userId)
          if (current) current.status = 'error'
        }).then(() => sendToUser(request.userId, 'conversation:error', { id: conversation.id }))
          .catch((storageError) => console.error('Could not save analysis failure state.', storageError))
      })
    } catch (error) {
      next(error)
    }
  })
})

app.patch('/api/conversations/:conversationId/tasks/:taskId', requireLocalOrigin, requireAuth, async (request, response, next) => {
  try {
    const { status } = request.body ?? {}
    if (!['open', 'done', 'dismissed'].includes(status)) return response.status(400).json({ error: 'Task status must be open, done, or dismissed.' })
    const updated = await store.update((data) => {
      const conversation = data.conversations.find((item) =>
        item.id === request.params.conversationId && item.userId === request.userId)
      const task = conversation?.report?.tasks.find((item) => item.id === request.params.taskId)
      if (task) task.status = status
      return Boolean(task)
    })
    if (!updated) return response.status(404).json({ error: 'Task not found.' })
    response.json({ status })
  } catch (error) {
    next(error)
  }
})

app.get('/api/conversations/:conversationId/export', requireAuth, async (request, response, next) => {
  try {
    const conversation = (await store.read()).conversations.find((item) =>
      item.id === request.params.conversationId && item.userId === request.userId)
    if (!conversation) return response.status(404).json({ error: 'Conversation not found.' })
    response.setHeader('Content-Disposition', `attachment; filename="${conversation.title.replace(/[^a-z0-9-_]+/gi, '_')}.json"`)
    response.type('application/json').send(JSON.stringify({
      title: conversation.title,
      createdAt: conversation.createdAt,
      messages: conversation.messages,
      report: conversation.report,
    }, null, 2))
  } catch (error) {
    next(error)
  }
})

app.delete('/api/conversations/:conversationId', requireLocalOrigin, requireAuth, async (request, response, next) => {
  try {
    const removed = await store.update((data) => {
      const index = data.conversations.findIndex((item) =>
        item.id === request.params.conversationId && item.userId === request.userId)
      if (index < 0) return false
      data.conversations.splice(index, 1)
      return true
    })
    if (!removed) return response.status(404).json({ error: 'Conversation not found.' })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.delete('/api/conversations', requireLocalOrigin, requireAuth, async (request, response, next) => {
  try {
    await store.update((data) => {
      data.conversations = data.conversations.filter((item) => item.userId !== request.userId)
    })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    next(new Error('This web origin is not configured for the local companion.'))
    return
  }
  const token = sessionTokenFromHandshake(socket.request)
  if (!isSessionTokenValid(token)) {
    next(new Error('Sign in to connect to local analysis updates.'))
    return
  }
  socket.userId = userFromRequest(socket.request)
  next()
})

io.on('connection', (socket) => {
  socket.join(`user:${socket.userId}`)
})

const distribution = resolve(root, 'dist')
if (existsSync(distribution)) {
  app.use(express.static(distribution, { index: false }))
  app.get(/.*/, (request, response, next) => {
    if (request.path.startsWith('/api') || request.path.startsWith('/socket.io')) return next()
    response.sendFile(resolve(distribution, 'index.html'))
  })
}

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error)
  const status = Number.isInteger(error.status) ? error.status : error.code === 'LIMIT_FILE_SIZE' ? 413 : 500
  if (status >= 500) console.error('Local API request failed.', error)
  response.status(status).json({ error: status >= 500 ? 'The local service could not complete this request.' : error.message })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Local API listening at http://127.0.0.1:${port}`)
})
