import { jest } from '@jest/globals'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AccessLogWriter } from './access-log-writer.js'
import { NullRedactor, type PhiRedactor } from './phi-redactor.js'
import type { AccessLogData } from '../prisma-extensions/access-log.extension.js'

// V-17 access-log-writer spec.
//
// Config-seam contract:
//   • LOG_SINK unset / 'off'      → dormant; logAccess() no-op
//   • LOG_SINK=s3                 → dormant + boot WARN (no S3 transport yet)
//   • LOG_SINK=file + Null redactor → transport built, no lines written (drop)
//   • LOG_SINK=file + real redactor → lines land in `access_log.<date>.<n>.log`
//   • Bad LOG_SINK config          → dormant; no crash (DB path stays intact)
//
// Rotation is exercised by writing >size threshold; pino-roll takes a fraction
// of a second to spawn the worker thread and flush the first line, so most
// tests wait for the file to appear before asserting content.

const SAMPLE: AccessLogData = {
  actorId: 'user-1',
  actorType: 'USER',
  systemActorLabel: null,
  runId: 'req-abc',
  practiceContext: 'practice-1',
  action: 'READ',
  modelName: 'JournalEntry',
  recordId: 'entry-42',
  ip: '127.0.0.1',
  userAgent: 'jest',
}

class PassThroughRedactor implements PhiRedactor {
  redact(payload: AccessLogData): AccessLogData {
    return payload
  }
}

// pino-roll's worker-thread flush isn't guaranteed synchronous — poll for
// the file to appear before asserting. Bounded so a real failure fails fast.
async function waitForFile(
  dir: string,
  predicate: (files: string[]) => boolean,
  timeoutMs = 3000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const files = readdirSync(dir)
      if (predicate(files)) return files
    } catch {
      // dir not yet created
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  // Timed out. readdirSync is SYNCHRONOUS, so the `.catch()` that used to be
  // here was never callable — on the timeout path it threw a TypeError and
  // masked the real assertion failure. Return whatever is on disk (or nothing)
  // so the caller's expectation produces a useful diff.
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// Poll until a condition holds. Used for state the transport worker changes
// asynchronously (e.g. the writer falling back to dormant on a transport
// error), which no synchronous assertion can observe.
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function flushAndDestroy(writer: AccessLogWriter) {
  writer.onModuleDestroy()
  // Give pino-roll's transport worker a beat to drain.
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('AccessLogWriter — V-17 (dormant-by-default access-log Pino writer)', () => {
  const created: string[] = []
  const originalSink = process.env.LOG_SINK
  const originalDir = process.env.ACCESS_LOG_FILE_DIR
  const originalSize = process.env.ACCESS_LOG_ROTATION_SIZE
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'v17-access-log-'))
    created.push(dir)
    return dir
  }

  afterEach(() => {
    if (originalSink === undefined) delete process.env.LOG_SINK
    else process.env.LOG_SINK = originalSink
    if (originalDir === undefined) delete process.env.ACCESS_LOG_FILE_DIR
    else process.env.ACCESS_LOG_FILE_DIR = originalDir
    if (originalSize === undefined) delete process.env.ACCESS_LOG_ROTATION_SIZE
    else process.env.ACCESS_LOG_ROTATION_SIZE = originalSize
    warnSpy.mockClear()
    errorSpy.mockClear()
  })

  afterAll(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    for (const dir of created) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore — Windows sometimes holds handles
      }
    }
  })

  it('LOG_SINK unset → dormant (no directory created, logAccess is a no-op)', async () => {
    delete process.env.LOG_SINK
    const dir = tempDir()
    process.env.ACCESS_LOG_FILE_DIR = join(dir, 'nested')

    const writer = new AccessLogWriter(new PassThroughRedactor())
    writer.onModuleInit()
    writer.logAccess(SAMPLE)
    await flushAndDestroy(writer)

    // pino-roll never ran; the nested dir was never created.
    const files = readdirSync(dir)
    expect(files).toEqual([])
  })

  it('LOG_SINK=off explicitly → dormant', () => {
    process.env.LOG_SINK = 'off'
    const writer = new AccessLogWriter(new PassThroughRedactor())
    writer.onModuleInit()
    // logAccess must not throw even after init returned early
    expect(() => writer.logAccess(SAMPLE)).not.toThrow()
  })

  it('LOG_SINK=s3 → dormant + boot WARN, no file writes', async () => {
    process.env.LOG_SINK = 's3'
    const dir = tempDir()
    process.env.ACCESS_LOG_FILE_DIR = dir

    const writer = new AccessLogWriter(new PassThroughRedactor())
    writer.onModuleInit()
    writer.logAccess(SAMPLE)
    await flushAndDestroy(writer)

    // Nothing should land in the file dir — writer stays dormant on s3.
    const files = readdirSync(dir)
    expect(files).toEqual([])
  })

  it('LOG_SINK=file + NullRedactor → transport built but no lines written', async () => {
    process.env.LOG_SINK = 'file'
    const dir = tempDir()
    process.env.ACCESS_LOG_FILE_DIR = dir

    const writer = new AccessLogWriter(new NullRedactor())
    writer.onModuleInit()
    writer.logAccess(SAMPLE)
    writer.logAccess(SAMPLE)
    await flushAndDestroy(writer)

    // Pino-roll opens the file lazily on first successful write; with a
    // dropping redactor there ARE no writes, so the file may or may not exist.
    // Either way, no content should have landed.
    const files = readdirSync(dir).filter((f) => f.startsWith('access_log'))
    for (const f of files) {
      const content = readFileSync(join(dir, f), 'utf8')
      expect(content).toBe('')
    }
  })

  it('LOG_SINK=file + PassThroughRedactor → line lands in a dated rotation file', async () => {
    process.env.LOG_SINK = 'file'
    const dir = tempDir()
    process.env.ACCESS_LOG_FILE_DIR = dir

    const writer = new AccessLogWriter(new PassThroughRedactor())
    writer.onModuleInit()
    writer.logAccess(SAMPLE)
    await flushAndDestroy(writer)

    // Wait for pino-roll's worker thread to create the file.
    const files = await waitForFile(dir, (fs) =>
      fs.some((f) => /^access_log\.\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(f)),
    )
    const match = files.find((f) =>
      /^access_log\.\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(f),
    )
    expect(match).toBeDefined()

    const content = readFileSync(join(dir, match!), 'utf8')
    // Pino writes one JSON per line, always includes the payload fields.
    expect(content).toMatch(/"actorId":"user-1"/)
    expect(content).toMatch(/"modelName":"JournalEntry"/)
    expect(content).toMatch(/"action":"READ"/)
  })

  it('bad LOG_SINK config keeps the writer dormant (async transport error, no crash)', async () => {
    process.env.LOG_SINK = 'file'
    // Point at a path pino-roll cannot write under to force an init failure.
    // On Windows a NUL device / on POSIX a bogus root path both fail; we use
    // a name that pino-roll's Windows validator rejects (contains '?').
    process.env.ACCESS_LOG_FILE_DIR = 'C:/?bad?path?'

    const writer = new AccessLogWriter(new PassThroughRedactor())
    // Init must not throw — but this assertion alone is NOT the guarantee.
    // pino-roll validates the filename inside the worker thread, so the
    // failure arrives as an async 'error' on the ThreadStream long after
    // onModuleInit() has returned. Before the transport 'error' handler
    // existed this spec passed while the event went unhandled and killed the
    // process. The real proof is that the writer falls back to dormant below.
    expect(() => writer.onModuleInit()).not.toThrow()

    await waitFor(() => writer.sinkMode === 'off')
    expect(writer.sinkMode).toBe('off')

    // Dormant writer must still be a safe no-op for callers.
    expect(() => writer.logAccess(SAMPLE)).not.toThrow()
    await flushAndDestroy(writer)
  })
})
