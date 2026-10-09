import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthHandlers, userFromRequest } from './auth.js'
import { JsonStore } from './store.js'

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this },
    end() { return this },
  }
}

test('creates a local account with a password hash and authenticates its session', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'echomind-auth-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'store.json')
  const store = new JsonStore(filePath)
  const handlers = createAuthHandlers(store)
  const signupResponse = mockResponse()

  await handlers.signup({
    body: { username: 'Sannidhi', email: 'SANNIDHI@example.com', password: 'a-private-password' },
    headers: {},
  }, signupResponse)

  assert.equal(signupResponse.statusCode, 201)
  assert.equal(signupResponse.body.user.username, 'Sannidhi')
  assert.equal(signupResponse.body.user.email, 'sannidhi@example.com')
  assert.equal('passwordHash' in signupResponse.body.user, false)
  const cookie = signupResponse.headers['Set-Cookie'].split(';')[0]
  const tokenRequest = { headers: { cookie } }
  assert.equal(userFromRequest(tokenRequest), signupResponse.body.user.id)

  const stored = JSON.parse(await readFile(filePath, 'utf8'))
  assert.notEqual(stored.users[0].passwordHash, 'a-private-password')
  assert.equal(stored.users[0].email, 'sannidhi@example.com')

  const loginResponse = mockResponse()
  await handlers.login({
    body: { email: 'sannidhi@example.com', password: 'a-private-password' },
    headers: {},
  }, loginResponse)
  assert.equal(loginResponse.body.user.id, signupResponse.body.user.id)

  await assert.rejects(handlers.login({
    body: { email: 'sannidhi@example.com', password: 'wrong-password' },
    headers: {},
  }, mockResponse()), /incorrect/)
})

test('rejects invalid and duplicate local account credentials', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'echomind-duplicate-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const handlers = createAuthHandlers(new JsonStore(join(directory, 'store.json')))
  const request = { body: { username: 'Sannidhi', email: 'user@example.com', password: 'a-private-password' }, headers: {} }
  await handlers.signup(request, mockResponse())
  await assert.rejects(handlers.signup(request, mockResponse()), /already exists/)
  await assert.rejects(handlers.signup({
    body: { username: 'S', email: 'not-an-email', password: 'short' },
    headers: {},
  }, mockResponse()), /Username must contain/)
})
