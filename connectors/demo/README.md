VIGENTE

# Conector de demostración · contrato de herramientas de cobros

Servidor MCP con las dos herramientas de cobros sobre una cartera de cinco facturas falsas. Existe para que la prueba técnica del stack y la integración continua no dependan del acceso a Odoo.

**Este documento es el contrato que cumplen dos conectores**: este y «Conector Odoo v0», que se construye en paralelo sobre la instancia real de Bitclick. Los nombres, los esquemas de entrada, la forma de la salida, el orden de la lista y los motivos de error son los mismos en los dos. Cambiar uno aquí sin cambiarlo allí rompe la promesa de que el plano de control es agnóstico del ERP (ADR-001), que es justo lo que la prueba técnica demuestra.

- Rebanada que lo implementa: «Prueba técnica del stack: Temporal, bucle del agente sobre AI SDK y gateway MCP» (`docs/specs/prueba-tecnica-del-stack.md`).
- Contrato ejecutable: `src/servidor.test.ts`. Si una de esas pruebas falla, uno de los dos conectores ha dejado de cumplir lo acordado.

## Las dos herramientas

### `listar_facturas_vencidas` · clase de acción `lectura`

Anotada con `readOnlyHint: true` y `_meta["aiw.clase"] = "lectura"`. El gateway lee la anotación para clasificar el paso; el modelo no vota.

Entrada, toda opcional:

| Campo                 | Tipo         | Por defecto | Notas                                                          |
| --------------------- | ------------ | ----------- | -------------------------------------------------------------- |
| `dias_vencida_minimo` | entero ≥ 0   | 1           | Un mínimo de 0 no cuela facturas al día: al día no es vencida. |
| `limite`              | entero 1–200 | 50          | Recorta por arriba, así que se queda con las más vencidas.     |

Salida:

```json
{
  "facturas": [
    {
      "id": "inv-0001",
      "numero": "F-2026-0001",
      "cliente": { "id": "cli-001", "nombre": "Talleres Mediterráneo, S.L." },
      "importe_pendiente": 1240.5,
      "moneda": "EUR",
      "fecha_emision": "2026-07-16",
      "fecha_vencimiento": "2026-08-15",
      "dias_vencida": 37
    }
  ],
  "total": 1
}
```

- `moneda` en ISO 4217. Las fechas en `YYYY-MM-DD`, sin hora.
- Ordenadas de más a menos `dias_vencida`.
- **Nunca devuelve facturas no vencidas.** Es la mitad del contrato: el eval del puesto Cobros comprueba que el agente no escribe a quien no debe nada.

### `crear_nota_seguimiento` · clase de acción `escritura`

Anotada con `readOnlyHint: false` y `_meta["aiw.clase"] = "escritura"`.

Entrada:

| Campo                | Tipo                  | Obligatorio | Notas                                                                    |
| -------------------- | --------------------- | ----------- | ------------------------------------------------------------------------ |
| `factura_id`         | cadena                | sí          | El `id` que devolvió la lista. Este conector acepta también el `numero`. |
| `texto`              | cadena 1–2000         | sí          | Sin HTML.                                                                |
| `tipo`               | `nota` \| `actividad` | no          | `nota` por defecto.                                                      |
| `fecha_limite`       | `YYYY-MM-DD`          | no          | Solo con `tipo: "actividad"`. Con `nota` devuelve `invalido`.            |
| `clave_idempotencia` | cadena                | no          | Con la misma clave, la misma nota.                                       |

Salida:

```json
{
  "id": "nota-0001",
  "factura_id": "inv-0001",
  "tipo": "nota",
  "creado_en": "2026-09-21T09:00:00.000Z"
}
```

**Idempotencia.** Con la misma `clave_idempotencia` se devuelve el mismo `id` y no se crea otra nota, aunque el resto de los argumentos lleguen distintos: manda la primera llamada. Es lo que hace seguro reintentar una escritura, y sin ella el reintento de una actividad de Temporal duplicaría notas.

## Errores

Un error de herramienta en MCP no es un error del protocolo: viaja como resultado con `isError: true`, porque la llamada llegó y se atendió, y lo que falló es lo que se pedía. El cuerpo es JSON y lleva siempre tres cosas:

```json
{
  "code": "FACTURA_NO_ENCONTRADA",
  "message": "No existe la factura inv-9999.",
  "datos": { "motivo": "no_encontrada" }
}
```

| `motivo`        | `code` de este conector | ¿Se reintenta? |
| --------------- | ----------------------- | -------------- |
| `no_encontrada` | `FACTURA_NO_ENCONTRADA` | No             |
| `no_autorizado` | `NO_AUTORIZADO`         | No             |
| `temporal`      | `ERROR_TEMPORAL`        | **Sí**         |
| `invalido`      | `ARGUMENTOS_NO_VALIDOS` | No             |

- El `message` va en español: lo lee la persona que abra la auditoría.
- El `code` sirve para agrupar en consultas; se añaden valores, no se renombran.
- El único campo que la plataforma interpreta es `datos.motivo`. Lo lee `@aiw/domain` (`leerErrorDeHerramienta`, `esReintentable`) y lo aplica el trabajador: los tres motivos que no se reintentan se convierten en un fallo no reintentable de Temporal, así que la tarea falla ya en vez de esperar cuatro intentos con espera creciente.
- Un fallo que **no** cumple este contrato se reintenta. Es la decisión prudente: lo más probable es que sea de red o del transporte.
- Este conector produce los cuatro motivos y `servidor.test.ts` los ejercita: `no_encontrada` con una factura que no existe, `invalido` con argumentos fuera del contrato, `temporal` con el fallo inyectable y `no_autorizado` al revocar la credencial con la conexión abierta (`revocarCredencial()`), que es lo que hace un sistema de gestión cuando alguien invalida la clave de API.
- Los cuatro motivos están escritos también en `@aiw/domain`. No se importan de allí: un servidor MCP es un programa independiente y un conector de terceros tampoco podría importarlo. Lo que los mantiene sincronizados es este documento y las pruebas.

Los rangos (`limite`, longitud de `texto`) se comprueban en el manejador y no en el esquema Zod. Con el rango en el esquema, el SDK rechaza la llamada él mismo y devuelve un error del protocolo (`-32602`) que no lleva `datos.motivo`, y la plataforma tendría que adivinar si conviene reintentar. El tipo lo valida el esquema —eso sí lo entiende el modelo— y el rango lo valida el conector, que es quien puede contestar en el formato acordado.

## Transportes

El servidor no elige transporte: lo elige quien lo consume. El registro del gateway guarda **fábricas** de transporte, así que puede registrar cualquiera de los tres sin enterarse.

| Transporte        | Para qué                                                           | Cómo llega la credencial                                  |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| En memoria        | Pruebas y el trabajador que monta el conector en su propio proceso | Argumento de `montarDemoEnMemoria`                        |
| Entrada estándar  | Conector lanzado como proceso hijo                                 | Variable de entorno del hijo, inyectada por el gateway    |
| HTTP transmisible | Conector que ya está corriendo en otro sitio, como el de Odoo      | Cabecera `Authorization: Bearer …`, puesta por el gateway |

```bash
# Entrada y salida estándar
DEMO_CONECTOR_SECRETO=... pnpm --filter @aiw/connector-demo servir

# HTTP transmisible, en DEMO_CONECTOR_PUERTO (4020 por defecto)
DEMO_CONECTOR_SECRETO=... pnpm --filter @aiw/connector-demo servir --http
```

Desde la plataforma, con `@aiw/mcp-gateway`:

```ts
registro.registrar('demo-cobros', (secreto) =>
  conexionPorProcesoHijo('demo-cobros', secreto, {
    comando: 'pnpm',
    argumentos: ['exec', 'tsx', 'src/main.ts'],
    variableDelSecreto: 'DEMO_CONECTOR_SECRETO',
    directorio: rutaDelConector,
  }),
);

registro.registrar('odoo', (secreto) => conexionPorHttp('odoo', secreto, { url: 'https://…/mcp' }));
```

## Credencial

La credencial llega por `DEMO_CONECTOR_SECRETO` y se comprueba **al construir el servidor**, no en los argumentos de cada llamada. Así el secreto vive en la conexión y no existe ninguna ruta por la que pueda acabar en un mensaje al modelo. Un conector mal configurado falla al arrancar y no a mitad de una tarea.

Cuando el gateway lanza el conector como proceso hijo, le construye el entorno desde cero y le pone solo `PATH` y su propia credencial: un conector no tiene por qué ver las credenciales de los otros ni la cadena de conexión de la base solo porque su proceso padre las tenga. Y no va en la línea de mandatos, porque los argumentos de un proceso se ven en la lista de procesos de la máquina.

En `.env.example` el valor es `GENERAR`: `pnpm dev:up` lo sustituye por un valor aleatorio local. No hay ninguna credencial real en el repositorio, y dos pruebas rastrean su valor por el catálogo, los resultados, las trazas, el libro de auditoría y las filas de paso.

## Fallo inyectable

`crearServidorDemo({ fallosIniciales: 3 })` hace que las tres primeras llamadas devuelvan `datos.motivo: "temporal"`. Por entrada estándar y por HTTP se pide con `DEMO_CONECTOR_FALLOS`.

Sin un fallo que se pueda pedir, y que además sea reintentable según el contrato, no hay forma de probar que la actividad de Temporal reintenta con espera creciente y que al cuarto fallo la tarea pasa a `fallida`.

## La cartera de prueba

Cinco facturas, tres vencidas a la fecha fija `2026-09-21`. Las dos que no lo están son el caso negativo del eval del puesto Cobros. Las fechas y el reloj son fijos a propósito: la integración continua no puede depender de qué día se ejecute.
