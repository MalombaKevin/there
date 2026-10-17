// Runs the Django backend (:8000) and the Vite frontend (:5173) together.
//   npm run dev       -> migrate, then start both servers (Ctrl+C stops both)
//   npm run migrate   -> apply database migrations only
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dirname
const backend = join(root, 'backend')
const frontend = join(root, 'frontend')
const win = process.platform === 'win32'
const python = join(backend, '.venv', win ? 'Scripts/python.exe' : 'bin/python')

if (!existsSync(python)) {
  console.error('Missing backend/.venv. Run: cd backend && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt')
  process.exit(1)
}
if (!existsSync(join(frontend, 'node_modules'))) {
  console.log('Installing frontend packages...')
  spawnSync('npm', ['install'], { cwd: frontend, stdio: 'inherit', shell: win })
}

const migrate = spawnSync(python, ['manage.py', 'migrate', '--noinput'], { cwd: backend, stdio: 'inherit' })
if (migrate.status !== 0) process.exit(migrate.status ?? 1)
if (process.argv[2] === 'migrate') process.exit(0)

const children = []
function run(name, cmd, args, cwd, shell = false) {
  const child = spawn(cmd, args, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n'
  child.stdout.on('data', (d) => process.stdout.write(prefix(d)))
  child.stderr.on('data', (d) => process.stderr.write(prefix(d)))
  child.on('exit', (code) => { console.log(`[${name}] stopped (${code})`); stop() })
  children.push(child)
}

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  for (const c of children) {
    if (c.exitCode !== null) continue
    if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' })
    else c.kill()
  }
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

run('backend', python, ['manage.py', 'runserver', '127.0.0.1:8000'], backend)
run('frontend', 'npm', ['run', 'dev'], frontend, win)
console.log('\n  OPIO: open http://localhost:5173  (Ctrl+C to stop)\n')
