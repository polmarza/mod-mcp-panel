/** Estado según `claude mcp list` (fuera de la sesión) o según esta sesión. */
export type Estado = 'conectado' | 'sesion' | 'falla' | 'apagado' | 'sin-aprobar' | 'desconocido'

/** `proyecto`: en el .mcp.json de la carpeta. `local`: añadido con --scope local. */
export type Ambito = 'proyecto' | 'local'

export type Conector = {
  nombre: string
  destino: string
  ambito: Ambito
  /** Lo que dice `claude mcp list`: el estado real ahora mismo. */
  fuera: Estado
  /** Lo que tiene esta sesión, según `$.mcp.connect` (solo lee). */
  sesion: Estado
}

export type Panel = {
  conectores: Conector[]
  /** Cuántos servidores globales (usuario, claude.ai) se han dejado fuera. */
  globales: number
  cargando: boolean
  revisadoA: number | null
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mcp-panel': { panel: Shaped<Panel>; trabajando: string[] }
  }
}
