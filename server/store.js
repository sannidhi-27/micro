import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const emptyStore = () => ({ users: [], conversations: [] })

export class JsonStore {
  constructor(filePath = resolve('.local-data', 'private-store.json')) {
    this.filePath = filePath
    this.queue = Promise.resolve()
  }

  async read() {
    try {
      const content = await readFile(this.filePath, 'utf8')
      const data = JSON.parse(content)
      if (!Array.isArray(data.users) || !Array.isArray(data.conversations)) {
        throw new Error('Local data file has an invalid structure.')
      }
      return data
    } catch (error) {
      if (error.code === 'ENOENT') return emptyStore()
      throw error
    }
  }

  async update(mutator) {
    const task = this.queue.then(async () => {
      const data = await this.read()
      const result = await mutator(data)
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
      return result
    })
    this.queue = task.catch(() => {})
    return task
  }
}

export function userConversations(store, userId) {
  return store.read().then(({ conversations }) => conversations.filter((conversation) => conversation.userId === userId))
}
