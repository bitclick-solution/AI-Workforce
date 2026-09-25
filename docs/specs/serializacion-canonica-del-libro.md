VIGENTE

# Especificación · Serialización canónica del libro (hash independiente del cliente)

- Rebanada: [Notion](https://app.notion.com/p/3e15306618988122a296f22d83950a8f) · Tipo Plataforma · Paquetes `packages/ledger` · P0
- Rama: `rebanada/serializacion-canonica-del-libro`
- Plan de referencia: ADR-003 (libro de auditoría) y ADR-010 (exportación y verificación), que prometen verificabilidad a seis años vista.
- Zona crítica: sí — `packages/ledger` (libro de auditoría). Revisión humana obligatoria de Jesús.

## Objetivo

`anotar` firma `creadoEn` (la hora de `clock_timestamp()`) tal y como la devuelve el cliente que ejecuta la consulta. `drizzle-orm/postgres-js` sustituye, en el mismo objeto de cliente que recibe, los analizadores de los tipos de fecha (1082, 1083, 1114, 1184, entre otros) por la identidad: donde un cliente crudo de `postgres` da un `Date`, uno pasado por `drizzle()` da el texto tal cual lo manda Postgres. La entrada firmada es la misma, pero el texto que se firma no, así que el mismo contenido calcula hashes distintos según quién escribió o quién verifica. Esta rebanada hace que el hash del libro dependa solo del contenido, nunca del cliente: `creadoEn` se normaliza siempre a texto ISO 8601 en UTC antes de firmar y de verificar, y las entradas ya escritas —que no pasaron por esa normalización— siguen verificando con la regla con la que se firmaron.

## Paquetes tocados

- `packages/ledger` (`src/hash.ts`, `src/libro.ts`, `src/exportar.ts` — este último solo para que `verificarRango` use la misma regla de compatibilidad que `verificarCadena`; no cambia su firma).

## Endpoints, flujos y datos

Ninguno. No hay migración ni cambio de esquema: la columna `entrada_auditoria.creado_en` no cambia, solo cómo se serializa su valor antes de firmarlo.

## Criterios de hecho

1. El hash de cada entrada se calcula sobre una serialización canónica que no depende del cliente: `creadoEn` se normaliza siempre a texto ISO 8601 en UTC (`normalizarFecha`, en `hash.ts`), tanto si llega como `Date` (cliente crudo de `postgres`) como si llega como el texto que devuelve Postgres cuando `drizzle-orm/postgres-js` ha sustituido el analizador (por ejemplo `2026-09-20 12:45:00.123+00`). `clock_timestamp()` da microsegundos y un `Date` de JavaScript solo tiene milisegundos: `normalizarFecha` trunca la fracción a sus tres primeras cifras, igual que `new Date(texto)` —lo que usa el cliente crudo de `postgres` para analizar esa misma columna—, y no la redondea; redondear daría un `Date` distinto al del cliente crudo para una fracción que no cae en un múltiplo de milisegundo. El resto de la serialización —orden de claves, `null` explícito— no cambia.
2. Una prueba con PostgreSQL real construye la misma marca de tiempo con un cliente crudo de `postgres` (da un `Date`) y con un cliente al que se le ha aplicado `drizzle()` (da el texto de Postgres, porque `drizzle()` sustituye los analizadores del cliente que recibe) y comprueba que `calcularHash` sobre el mismo contenido da el mismo hash con las dos representaciones.
3. `verificarCadenaEnBase` (y `exportarLibro`, que verifica con `verificarRango`) dan el mismo resultado —válida o no, y en qué eslabón rompe si no— leyendo la misma cadena con el cliente crudo y con un cliente pasado por `drizzle()`.
4. Las entradas anotadas antes de esta rebanada se firmaron sin normalizar `creadoEn`: si el cliente que escribió daba `Date`, el texto firmado ya era ISO y la regla nueva las verifica igual que siempre. Si daba el texto de Postgres sin normalizar, la regla nueva no cuadra; para esas, `verificarCadena` y `verificarRango` reintentan con `calcularHashLegado` —la serialización de antes de esta rebanada, sin tocar `creadoEn`— antes de declarar la entrada alterada. La regla nueva rige para toda entrada anotada a partir de esta rebanada; la regla antigua queda solo como conmutación de compatibilidad para lo ya escrito, documentada aquí y en el código (`hash.ts`), y no la usa ninguna escritura nueva.
5. No hay cambio de esquema: la migración existente de `entrada_auditoria` no se toca.

## Casos de prueba y de eval

- Unitario, sin base de datos (`packages/ledger/src/hash.test.ts`): `normalizarFecha` da el mismo `Date` para un `Date` de entrada y para el texto de Postgres equivalente, con y sin fracción de segundo, con offset `+00`, con offset de más de una cifra (`+02`, `+02:30`) y con `Z`; rechaza un texto que no reconoce. `calcularHash` da el mismo resultado para un `ContenidoEntrada` con `creadoEn: Date` y con `creadoEn` como el texto equivalente. `calcularHashLegado` reproduce exactamente el cálculo de antes de esta rebanada (sin normalizar), para que la prueba de compatibilidad tenga con qué comparar. `verificarCadena` con una cadena mixta —unos eslabones firmados con la regla antigua (`calcularHashLegado`) y otros con la nueva (`calcularHash`), encadenados entre sí— da `valida: true`; con un eslabón antiguo alterado, sigue detectando la alteración (`rotaEn` en el eslabón que corresponde).
- Integración con PostgreSQL (`packages/ledger/src/pruebas/libro.test.ts`): `anotar` escribe una entrada con el cliente crudo de `@aiw/db/pruebas`; se lee esa misma fila con un segundo cliente al que se le aplica `drizzle()` (mismo `DATABASE_URL`, sin tocar el esquema de Drizzle: solo se usa para que `postgres` sustituya sus analizadores de fecha, igual que hace la aplicación); `calcularHash` sobre el contenido leído por cada cliente da el mismo hash, y `verificarCadenaEnBase` da `valida: true` leyendo con cualquiera de los dos.
- Auditoría y contador: no aplica — esta rebanada no cambia qué se anota ni qué suma al contador, solo cómo se firma lo ya anotado.
- Secretos: no aplica — no hay credenciales nuevas ni tocadas.

## Fuera de alcance

- Cualquier cambio de esquema o de columna de `entrada_auditoria`: esta rebanada no lo necesita y el libro es de solo añadir.
- Normalizar otras fechas del dominio (`vence_en` de una aprobación, `creadoEn` de `uso_modelo`): no entran en el hash del libro y no son parte de este hallazgo.
- Purgar o migrar entradas ya escritas: quedan tal cual, verificadas con la regla que les corresponde.

## Deuda conocida

1. **`calcularHashLegado` no normaliza, así que una entrada de antes de esta rebanada solo verifica si se relee con el mismo tipo de representación —texto o `Date`— con el que se firmó.** Mientras la aplicación siga leyendo siempre con el mismo cliente por defecto (el que pasa por `drizzle()`), esto es estable. Si en el futuro cambia el cliente de lectura por defecto del libro, las entradas de antes de esta rebanada podrían dejar de verificar sin haber sido alteradas —una entrada nueva no tiene este problema, porque `calcularHash` sí normaliza—. Se paga si ese cambio de cliente llega a proponerse: entonces hace falta decidir qué representación asumir para lo ya escrito, o aceptar que ese lote deja de verificar por este motivo y hay que reconstruirlo desde una copia de seguridad anterior al cambio.

## Presupuesto de tokens

Presupuesto: 15 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.
