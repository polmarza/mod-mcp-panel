// Panel «Conectores MCP»: los servidores MCP propios del proyecto (los del
// .mcp.json y los añadidos con --scope local para esta carpeta; los globales
// y los de claude.ai no salen), con dos estados:
//
//   - «fuera»: lo que dice `claude mcp list` ahora mismo, en la carpeta de la
//     sesión. Es el estado real (si ya iniciaste sesión en otra terminal, aquí
//     sale conectado).
//   - «sesión»: lo que tiene esta sesión, leído con `$.mcp.connect`, que no
//     marca ni cambia nada, solo informa.
//
// Cuando no coinciden (típico: autenticaste en la terminal y la sesión del
// escritorio sigue con el estado con que arrancó), el botón «Reconectar»
// intenta que la sesión lo recoja. Si de verdad falta iniciar sesión, el botón
// «Abrir terminal» abre una en la carpeta del proyecto para hacer /mcp.
import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Ambito, Conector, Estado, Panel } from '../types'

const PANE = 'mcp-panel'
const TITULO = 'Conectores MCP'

const VACIO: Panel = { conectores: [], globales: 0, cargando: false, revisadoA: null, error: null }
// Sube la etiqueta si cambian los campos de Panel o Conector.
const panel = atom({ plugin: 'mcp-panel', key: 'panel' } as const, VACIO, { shape: 'panel-2' })
const trabajando = atom({ plugin: 'mcp-panel', key: 'trabajando' } as const, [] as string[])

type Dollar = Parameters<Hook<'session.start'>>[0]

function estadoFuera(texto: string): Estado {
  const t = texto.toLowerCase()
  if (t.includes('connected') && !t.includes('fail')) return 'conectado'
  if (t.includes('auth')) return 'sesion'
  if (t.includes('fail') || t.includes('error')) return 'falla'
  if (t.includes('disabled')) return 'apagado'
  if (t.includes('pending') || t.includes('approv')) return 'sin-aprobar'
  return 'desconocido'
}

/** Una línea de `claude mcp list`: `nombre: destino - ✓ Connected`. */
export function leerLinea(linea: string): { nombre: string; destino: string; fuera: Estado } | null {
  const m = /^(.*?): (.*) - (.*)$/.exec(linea.trim())
  const [, nombre, destino, estado] = m ?? []
  if (!nombre || destino === undefined || !estado) return null
  return { nombre, destino, fuera: estadoFuera(estado) }
}

const ORDEN: Record<Estado, number> = {
  falla: 0,
  sesion: 1,
  'sin-aprobar': 2,
  desconocido: 3,
  apagado: 4,
  conectado: 5,
}

/** Primero lo que no cuadra o no funciona; luego por ámbito y nombre. */
export function ordenar(lista: readonly Conector[]): Conector[] {
  const peso = (c: Conector) => Math.min(ORDEN[c.fuera], ORDEN[c.sesion]) - (c.fuera !== c.sesion ? 10 : 0)
  const amb: Record<Ambito, number> = { proyecto: 0, local: 1 }
  return [...lista].sort(
    (a, b) => peso(a) - peso(b) || amb[a.ambito] - amb[b.ambito] || a.nombre.localeCompare(b.nombre),
  )
}

async function estadoSesion($: Dollar, nombre: string): Promise<Estado> {
  try {
    const r = await $.mcp.connect(nombre)
    if (r.isConnected) return 'conectado'
    switch (r.reason) {
      case 'auth':
        return 'sesion'
      case 'failed':
        return 'falla'
      case 'disabled':
        return 'apagado'
      case 'unapproved':
        return 'sin-aprobar'
      default:
        return 'desconocido'
    }
  } catch {
    return 'desconocido'
  }
}

/**
 * Los MCP propios del proyecto: los del `.mcp.json` de la carpeta (`proyecto`,
 * se comparten con el repo) y los añadidos solo para esta carpeta con
 * `claude mcp add --scope local` (`local`, en `~/.claude.json` → projects).
 */
async function propiosDelProyecto($: Dollar, carpetas: readonly string[]): Promise<Map<string, Ambito>> {
  const propios = new Map<string, Ambito>()
  for (const cwd of carpetas) {
    try {
      const json = JSON.parse(String(await $.fs.read(`${cwd}/.mcp.json`))) as { mcpServers?: Record<string, unknown> }
      for (const n of Object.keys(json.mcpServers ?? {})) propios.set(n, 'proyecto')
    } catch {
      // Sin .mcp.json en esa carpeta.
    }
  }
  try {
    const home = await $.env.get('HOME')
    const conf = JSON.parse(String(await $.fs.read(`${home}/.claude.json`))) as {
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>
    }
    for (const cwd of carpetas) {
      for (const n of Object.keys(conf.projects?.[cwd]?.mcpServers ?? {})) if (!propios.has(n)) propios.set(n, 'local')
    }
  } catch {
    // Sin ~/.claude.json legible: solo cuentan los del .mcp.json.
  }
  return propios
}

async function revisar($: Dollar): Promise<void> {
  await update($, panel, p => ({ ...p, cargando: true, error: null }))
  try {
    const cwd = await $.session.cwd()
    const shell = (await $.env.get('SHELL')) || '/bin/zsh'
    // Shell de login para que `claude` esté en el PATH como en la terminal.
    const res = await $.process.run([String(shell), '-lc', 'claude mcp list'], { cwd, timeoutMs: 120_000 })
    const raiz = await $.session.root().catch(() => cwd)
    const propios = await propiosDelProyecto($, [...new Set([cwd, raiz])])
    const todas = res.stdout
      .split('\n')
      .map(leerLinea)
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const filas = todas.filter(f => propios.has(f.nombre))
    if (todas.length === 0) {
      await update($, panel, p => ({
        ...p,
        cargando: false,
        error: `claude mcp list no devolvió servidores (salida ${res.exitCode}). ${res.stderr.slice(0, 200)}`,
      }))
      return
    }
    const conectores: Conector[] = await Promise.all(
      filas.map(async f => ({
        ...f,
        ambito: propios.get(f.nombre) ?? 'proyecto',
        sesion: await estadoSesion($, f.nombre),
      })),
    )
    const ahora = await $.clock.now()
    await update($, panel, () => ({
      conectores: ordenar(conectores),
      globales: todas.length - filas.length,
      cargando: false,
      revisadoA: ahora,
      error: null,
    }))
  } catch (err) {
    await update($, panel, p => ({
      ...p,
      cargando: false,
      error: `No pude revisar los conectores: ${err instanceof Error ? err.message : String(err)}`,
    }))
  }
}

async function reconectar($: Dollar, nombre: string): Promise<void> {
  await update($, trabajando, l => [...l, nombre])
  try {
    let r = await $.mcp.connect(nombre)
    if (!r.isConnected) {
      // `$.mcp.call` vuelve a marcar un servidor remoto caído con la sesión ya
      // guardada; con una herramienta que no existe basta para forzar el intento.
      try {
        await $.mcp.call(nombre, '__comprobar_conexion__', {})
      } catch {
        // Se espera un error: lo que importa es el intento de conexión.
      }
      r = await $.mcp.connect(nombre)
    }
    $.ui.toast(r.isConnected ? `${nombre}: conectado en esta sesión` : `${nombre}: ${r.message}`)
  } catch (err) {
    $.ui.toast(`${nombre}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, trabajando, l => l.filter(n => n !== nombre))
    await revisar($)
  }
}

async function abrirTerminal($: Dollar): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    await $.process.run(['open', '-a', 'Terminal', cwd])
    $.ui.toast('Terminal abierta en la carpeta del proyecto: escribe claude y luego /mcp')
  } catch (err) {
    $.ui.toast(`No pude abrir la terminal: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const ETIQUETA: Record<Estado, string> = {
  conectado: 'conectado',
  sesion: 'falta iniciar sesión',
  falla: 'falla',
  apagado: 'apagado',
  'sin-aprobar': 'sin aprobar',
  desconocido: '¿?',
}

// Dos marcas y dos colores, sin más matices: ✓ en verde si la sesión lo tiene
// conectado, ⚠ en naranja si no. La forma distingue el estado aunque no se
// distingan los colores (daltonismo).
function marca(e: Estado): { icono: string; color: 'success' | 'warning' } {
  return e === 'conectado' ? { icono: '✓', color: 'success' } : { icono: '⚠', color: 'warning' }
}

function hace(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `hace ${s} s`
  return `hace ${Math.round(s / 60)} min`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'conectores',
      description: 'Abre el panel de conectores MCP del proyecto y los revisa',
    })
    void $.ui.open({ id: PANE, title: TITULO })
    void revisar($)
    return next(e)
  })

  on('command.run', { command: 'conectores' }, async $ => {
    await $.ui.open({ id: PANE, title: TITULO })
    void revisar($)
    return { text: 'Panel de conectores abierto; revisando…' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = await read($, panel)
    const enCurso = await read($, trabajando)
    const ahora = await $.clock.now()
    const conProblema = p.conectores.filter(c => c.fuera !== 'conectado' || c.sesion !== 'conectado')
    const bien = p.conectores.length - conProblema.length

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="revisar" label={p.cargando ? 'Revisando…' : 'Revisar de nuevo'} onPress={() => revisar($)} />
          <Button key="terminal" label="Abrir terminal" onPress={() => abrirTerminal($)} />
        </Box>
        {p.error && <Text color="red">{p.error}</Text>}
        {p.revisadoA !== null && (
          <Text dimColor>
            {bien} de {p.conectores.length} bien · revisado {hace(ahora - p.revisadoA)}
            {p.globales > 0 ? ` · ${p.globales} globales sin mostrar` : ''}
          </Text>
        )}
        {p.revisadoA !== null && p.conectores.length === 0 && (
          <Text dimColor>Este proyecto no tiene MCP propios (.mcp.json ni --scope local).</Text>
        )}
        {p.revisadoA === null && !p.error && <Text dimColor>Revisando los conectores (tarda unos segundos)…</Text>}
        {p.conectores.map(c => {
          const descuadre = c.fuera !== c.sesion
          const ocupado = enCurso.includes(c.nombre)
          return (
            <Box key={c.nombre} flexDirection="column">
              <Text bold={c.sesion !== 'conectado'}>
                <Text color={marca(c.sesion).color}>{marca(c.sesion).icono}</Text> {c.nombre} <Text dimColor>· {c.ambito === 'local' ? 'local, solo tú' : '.mcp.json'}</Text>
              </Text>
              <Text dimColor>
                {'  '}esta sesión: <Text color={marca(c.sesion).color}>{ETIQUETA[c.sesion]}</Text> · real:{' '}
                <Text color={marca(c.fuera).color}>{ETIQUETA[c.fuera]}</Text>
                {descuadre && c.fuera === 'conectado' ? ' → la sesión no lo ha recogido' : ''}
              </Text>
              {c.sesion !== 'conectado' && c.sesion !== 'apagado' && (
                <Box flexDirection="row" gap={1}>
                  <Button
                    key={`reconectar:${c.nombre}`}
                    label={ocupado ? 'Reconectando…' : 'Reconectar'}
                    onPress={() => (ocupado ? undefined : reconectar($, c.nombre))}
                  />
                  {c.fuera !== 'conectado' && c.fuera === 'sesion' && (
                    <Text dimColor>falta iniciar sesión: «Abrir terminal» → claude → /mcp</Text>
                  )}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
