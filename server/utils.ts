import { readdir, readFile, stat } from 'fs/promises'
import type { Stats } from 'fs'

export function createLimiter(concurrency: number) {
  let running = 0
  const queue: Array<() => void> = []

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        running++
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--
            if (queue.length > 0) {
              const next = queue.shift()!
              next()
            }
          })
      }

      if (running < concurrency) {
        run()
      } else {
        queue.push(run)
      }
    })
  }
}

export async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

export async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath)
  } catch {
    return []
  }
}

export async function safeStat(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath)
  } catch {
    return null
  }
}
