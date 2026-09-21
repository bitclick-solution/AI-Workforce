VIGENTE

# Conector de demostración

Servidor MCP con las dos herramientas del conector de Odoo sobre una cartera de cinco facturas falsas. Existe para que la prueba técnica del stack y la integración continua no dependan del acceso a Odoo.

- Rebanada que lo implementa: «Prueba técnica del stack: Temporal, bucle del agente sobre AI SDK y gateway MCP» (`docs/specs/prueba-tecnica-del-stack.md`).
- Herramientas: `listar_facturas_vencidas` (lectura, `readOnlyHint: true`) y `crear_nota_seguimiento` (escritura).
- Cinco facturas, tres vencidas a la fecha fija `2026-09-21`. Las dos que no lo están son el caso negativo del eval del puesto Cobros.

## Cómo se usa

El servidor no elige transporte: lo elige quien lo consume.

- Las pruebas y el gateway lo montan en memoria con `InMemoryTransport.createLinkedPair()`. Es MCP de verdad —el mismo SDK, el mismo JSON-RPC— sin procesos ni puertos.
- El Compose de desarrollo lo arranca por entrada y salida estándar con `pnpm --filter @aiw/connector-demo servir`.

```bash
DEMO_CONECTOR_SECRETO=... pnpm --filter @aiw/connector-demo servir
```

## Credencial

La credencial llega por `DEMO_CONECTOR_SECRETO` y se comprueba **al conectarse**, no en los argumentos de cada llamada. Así el secreto vive en la conexión y no existe ninguna ruta por la que pueda acabar en un mensaje al modelo. Un conector mal configurado falla al conectarse y no a mitad de una tarea.

En `.env.example` el valor es `GENERAR`: `pnpm dev:up` lo sustituye por un valor aleatorio local. No hay ninguna credencial real en el repositorio, y una prueba del gateway rastrea los mensajes al modelo y las trazas buscando su valor.

## Fallo inyectable

`crearServidorDemo({ fallosIniciales: 3 })` hace que las tres primeras llamadas devuelvan error. Sin un fallo que se pueda pedir no hay forma de probar que la actividad de Temporal reintenta con espera creciente y que al cuarto fallo la tarea pasa a `fallida`.

MCP no propaga la excepción: el fallo de una herramienta viaja como resultado con `isError: true`. Quien lo convierte en un error del que Temporal se entera es el gateway.

## Cuando exista el conector de Odoo

El gateway registra el otro servidor y ni el bucle del agente ni las políticas cambian. Esa independencia es parte de lo que demuestra la prueba técnica (ADR-001: plano de control agnóstico del ERP).
