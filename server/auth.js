import { randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const cookieName = 'wm_session'
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const sessions = new Map()

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

function validateCredentials({ username, email, password }) {
  if (typeof username !== 'string' || username.trim().length < 2 || username.trim().length > 40) {
    throw Object.assign(new Error('Username must contain 2 to 40 characters.'), { status: 400 })
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw Object.assign(new Error('Enter a valid email address.'), { status: 400 })
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw Object.assign(new Error('Password must contain at least 10 characters.'), { status: 400 })
  }
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64)
  return { salt, hash: hash.toString('hex') }
}

function sessionCookie(token, crossOrigin) {
  const sameSite = crossOrigin ? 'None; Secure' : 'Strict'
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=')
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]
  }).filter(([name]) => name))
}

function isCrossOriginHttps(request) {
  const origin = request.get?.('origin')
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function issueSession(user, request, response) {
  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionLifetimeMs })
  response.setHeader('Set-Cookie', sessionCookie(token, isCrossOriginHttps(request)))
  return token
}

export function userFromRequest(request) {
  const token = parseCookies(request.headers.cookie)[cookieName]
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  return session.userId
}

export function sessionTokenFromHandshake(request) {
  return parseCookies(request.headers.cookie)[cookieName]
}

export function isSessionTokenValid(token) {
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token)
    return false
  }
  return true
}

export function createAuthHandlers(store) {
  return {
    async signup(request, response) {
      const { username, email, password } = request.body ?? {}
      validateCredentials({ username, email, password })
      const normalizedEmail = normalizeEmail(email)
      const credentials = await hashPassword(password)
      const user = {
        id: randomUUID(),
        username: username.trim(),
        email: normalizedEmail,
        passwordSalt: credentials.salt,
        passwordHash: credentials.hash,
        createdAt: new Date().toISOString(),
      }
      await store.update((data) => {
        if (data.users.some((existing) => existing.email === normalizedEmail)) {
          throw Object.assign(new Error('An account already exists for this email.'), { status: 409 })
        }
        data.users.push(user)
      })
      issueSession(user, request, response)
      response.status(201).json({ user: publicUser(user) })
    },

    async login(request, response) {
      const { email, password } = request.body ?? {}
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw Object.assign(new Error('Enter your email and password.'), { status: 400 })
      }
      const data = await store.read()
      const user = data.users.find((existing) => existing.email === normalizeEmail(email))
      if (!user) throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 })
      const candidate = await hashPassword(password, user.passwordSalt)
      const expectedHash = Buffer.from(user.passwordHash, 'hex')
      const candidateHash = Buffer.from(candidate.hash, 'hex')
      if (expectedHash.length !== candidateHash.length || !timingSafeEqual(expectedHash, candidateHash)) {
        throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 })
      }
      issueSession(user, request, response)
      response.json({ user: publicUser(user) })
    },

    async me(request, response) {
      const userId = userFromRequest(request)
      if (!userId) return response.status(401).json({ error: 'Sign in to continue.' })
      const user = (await store.read()).users.find((candidate) => candidate.id === userId)
      if (!user) return response.status(401).json({ error: 'Sign in to continue.' })
      response.json({ user: publicUser(user) })
    },

    logout(request, response) {
      const token = parseCookies(request.headers.cookie)[cookieName]
      if (token) sessions.delete(token)
      response.setHeader('Set-Cookie', sessionCookie('', isCrossOriginHttps(request)).replace(`Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`, 'Max-Age=0'))
      response.status(204).end()
    },
  }
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt }
}
