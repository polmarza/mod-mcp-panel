# Panel MCP para Claude Code

Un mod de Claude Code que abre un panel al lado del chat con los servidores MCP propios del proyecto en el que trabajas, y te dice de cada uno si funciona de verdad y si esta sesión lo tiene conectado. Si no coinciden, un botón lo reconecta sin reabrir la sesión.

Nace de un problema que se repite: inicias sesión en un MCP desde una terminal, la conexión ya funciona, pero la sesión que tenías abierta sigue viéndolo como «sin autenticar» porque guardó el estado con que arrancó.

## Instalación

En una sesión de Claude Code en el terminal:

```
/plugin marketplace add polmarza/mod-mcp-panel
/plugin install mcp-panel@mcp-panel
```

El primer comando añade el repositorio como marketplace; en el segundo eliges dónde instalarlo (para todos tus proyectos o solo para este).

Desde una terminal normal:

```
claude plugin marketplace add polmarza/mod-mcp-panel
claude plugin install mcp-panel@mcp-panel
```

En la app de escritorio, donde `/plugin` no funciona: pulsa + junto al cuadro de mensajes, luego Plugins, Add marketplace con `polmarza/mod-mcp-panel`, y después Add plugin.

Los mods de Claude Code están en acceso anticipado: alguna actualización puede cambiar cómo funcionan.

## Qué cuenta como MCP del proyecto

Solo los que pertenecen a la carpeta en la que trabajas:

- Los del `.mcp.json` del proyecto, que van con el repositorio.
- Los que añadiste solo para esa carpeta con `claude mcp add --scope local`, que solo ves tú.

Los globales (los de usuario y los conectores de claude.ai) no salen en la lista; una línea al pie dice cuántos se han dejado fuera.

## Uso

- El panel se abre solo al empezar la sesión. Si lo cierras, se vuelve a abrir con `/conectores`.
- Cada servidor enseña dos estados:
  - **real**: lo que dice `claude mcp list` en la carpeta del proyecto, ahora mismo;
  - **esta sesión**: lo que tiene la sesión abierta. Se lee sin cambiar nada.
- Arriba salen los que no cuadran o no funcionan.
- **Reconectar** aparece en los que esta sesión no tiene conectados e intenta que los recoja. Si ya iniciaste sesión en otra terminal, basta con eso.
- **Abrir terminal** abre una terminal en la carpeta del proyecto para cuando de verdad falta iniciar sesión: escribe `claude` y luego `/mcp`.
- **Revisar de nuevo** vuelve a comprobarlo todo; tarda unos segundos porque `claude mcp list` prueba cada servidor.

## Requisitos

- La orden `claude` en el `PATH` de tu shell de inicio de sesión, para `claude mcp list`.
- «Abrir terminal» usa la app Terminal de macOS.
