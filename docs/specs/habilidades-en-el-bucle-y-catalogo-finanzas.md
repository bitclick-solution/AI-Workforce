VIGENTE

# Especificación · Habilidades en el bucle del agente y catálogo inicial de finanzas para España

- Rebanada: [Notion](https://app.notion.com/p/3eb530661898819492ebc53f5b975885) · Ciclo 2 · Tipo Producto · Paquetes `apps/worker`, `apps/platform-agents`, `packages/evals` · P0
- Rama: `rebanada/habilidades-en-el-bucle-y-catalogo-finanzas`
- Plan de referencia: [ADR-005](../adr/ADR-005.md) (aprendizaje acotado a memoria, habilidades, parámetros en rango y ejemplos; evaluación en sombra; versiones inmutables con reversión), [ADR-007](../adr/ADR-007.md) (filas inmutables), [Modelo de datos v1](modelo-de-datos-v1.md) (`habilidad`, `habilidad_version_puesto`, `version_puesto.habilidades_congeladas`), [Aprendizaje v0](aprendizaje-v0.md) (la puerta del Evaluador) y la sección «Qué aprende el departamento» de la [ficha de Finanzas](../producto/finanzas.md).
- Zona crítica: **sí**. Esta rebanada mete contenido nuevo en el contexto del agente, que se comporta como un prompt, y activa versiones detrás de la puerta del Evaluador, que es una promoción del aprendizaje. No hay migración. «Revisión humana obligatoria» marcada en la rebanada y «Zona crítica: sí» en el PR.
- Depende de: «Proveedor real en el bucle del agente» (fusionada en #57). Con el guion determinista de pruebas, la carga se prueba pero el comportamiento con habilidades solo se certifica con un modelo real.

## Objetivo

Hoy los agentes no usan habilidades: la tabla `habilidad` y la columna `habilidades_congeladas` existen y `packages/learning` las copia de una versión de puesto a la siguiente, pero ningún código del bucle las lee. Con esta rebanada, el bucle carga las habilidades de la versión activa del puesto, y Cobros, Conciliación y Previsión arrancan con un catálogo inicial de nueve procedimientos para España que han pasado la puerta del Evaluador. Las habilidades preparan y comprueban; no dan asesoramiento fiscal ni legal, ni deciden por la persona.

## Decisiones que esta especificación fija

1. **Sin migración.** `habilidad` no tiene columna de descripción y añadirla es una migración (zona crítica de datos). La carga usa lo que ya hay: `nombre` y `casos_que_aplican` son lo que se carga siempre (cuándo usarla); `pasos` y `comprobaciones` son el cuerpo que se carga cuando la tarea lo pide.
2. **Carga en dos niveles.** Al empezar una tarea, el contexto del agente lleva un índice con una línea por habilidad congelada de su versión (nombre y casos que aplican). El cuerpo entra cuando el agente pide esa habilidad por su nombre con un paso interno del bucle, `cargar_habilidad`, con `claseAccion: 'lectura'` (la clase que `decidirPaso` reconoce en `packages/domain/src/politicas.ts`; con otro literal el paso se bloquearía por no tener nivel), que no pasa por el gateway porque no sale del proceso y solo lee lo congelado en la versión. Un nombre que no esté en la versión devuelve error y no carga nada.
3. **El paso `cargar_habilidad` deja rastro.** Pasa por los mismos ganchos del bucle que cualquier paso (política, presupuesto, auditoría) y no suma al contador de tareas; la habilidad cargada y su versión quedan en la entrada de auditoría. No cambia `decidirPaso` ni el motor de políticas.
4. **Una habilidad no rebaja ningún control.** Sus pasos no pueden pedir una acción que la política del puesto no permita: el nivel de cada clase de acción sigue mandando (por ejemplo, marcar una factura como dudosa sigue en N1 fijo aunque la habilidad la describa). Una habilidad que nombra una herramienta fuera de la lista blanca del puesto no se activa.
5. **Solo se activa si pasa la puerta del Evaluador.** El catálogo se siembra como versión de habilidad no activa y se activa con la misma puerta que ya usa la promoción de lecciones (`certificarPromocion`); si la puerta bloquea, no hay versión de puesto nueva. Las filas son inmutables: activar es crear la versión siguiente, no editar la fila.
6. **El catálogo es dato versionado en el repositorio** (`apps/platform-agents/src/catalogo/habilidades.json`, al lado de `plantillas.json`), con un campo `fuentes` por habilidad que la fila de base de datos no guarda. Se revisa en el PR como cualquier prompt.
7. **Contenido propio para España, no una traducción.** La estructura (listas de comprobación de cierre, conciliación, antigüedad de cobros y previsión de caja) puede inspirarse en [agency-agents/finance](https://github.com/msitarzewski/agency-agents/tree/main/finance), que es MIT y de contexto estadounidense (GAAP, ASC 842, 1099, SOX) y con perfiles de personaje, no procedimientos. Esta rebanada no copia texto de ese repositorio; si el Constructor reutiliza algún fragmento, conserva el aviso de copyright y la licencia en el archivo. Todo el fondo normativo se escribe contra fuentes oficiales (BOE, AEAT, AEB, Banco de España) y cada habilidad cita la suya; **el Constructor verifica cada cifra, plazo y fecha contra el texto consolidado vigente antes de escribirla**, porque esta especificación no las fija.

## Catálogo inicial

Nueve habilidades, tres por puesto, cada una con pasos, comprobaciones, casos que aplican y fuentes. Los nombres son provisionales.

| Puesto       | Habilidad                                | Qué prepara o comprueba                                                                                                                                                                                            | Fuente de referencia                                                               |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Cobros       | `cobros.antiguedad-de-cobros`            | Agrupa las facturas vencidas por tramos de antigüedad y comprueba que los importes suman lo que dice el ERP.                                                                                                       | Ficha de Finanzas                                                                  |
| Cobros       | `cobros.demora-ley-3-2004`               | Prepara el cálculo de plazo, interés de demora y coste de cobro con los parámetros del manual y lo presenta como propuesta; no reclama nada por sí sola.                                                           | Ley 3/2004, de medidas de lucha contra la morosidad en las operaciones comerciales |
| Cobros       | `cobros.lista-de-dudosos`                | Reúne las facturas que cumplen los criterios del manual y prepara la lista; marcar una como dudosa lo decide una persona (N1 fijo).                                                                                | Manual de la empresa                                                               |
| Conciliación | `conciliacion.leer-norma-43`             | Lee un extracto en formato Norma 43 y comprueba que saldo inicial más movimientos da el saldo final antes de casar nada.                                                                                           | Norma 43 de la AEB                                                                 |
| Conciliación | `conciliacion.devolucion-de-adeudo-sepa` | Reconoce una devolución de adeudo SEPA por su código de motivo, avisa a Cobros y escala siempre (ficha de Finanzas).                                                                                               | Normativa SEPA de adeudos directos                                                 |
| Conciliación | `conciliacion.casar-remesa`              | Casa una remesa o el abono de una pasarela con sus facturas dentro de la tolerancia del manual y deja el borrador de diferencia con contrapartida y documento.                                                     | Ficha de Finanzas; PGC de pymes para la cuenta de diferencias                      |
| Previsión    | `prevision.calendario-fiscal`            | Coloca en la previsión las obligaciones periódicas (modelos 303, 111, 115 y 202) en las fechas del calendario oficial del ejercicio y marca el importe como «a confirmar por administración»; no calcula la cuota. | Calendario del contribuyente de la AEAT                                            |
| Previsión    | `prevision.escenario-de-cobro-tardio`    | Desplaza los cobros de un cliente y recalcula el saldo a 30, 60 y 90 días frente al saldo mínimo del manual.                                                                                                       | Ficha de Finanzas                                                                  |
| Previsión    | `prevision.explicar-desvio`              | Explica un desvío de más del 15 % con sus causas verificables (cobros retrasados, pagos no previstos) y cita los documentos del ERP.                                                                               | Ficha de Finanzas                                                                  |

## Paquetes tocados

- `apps/worker`: el índice de habilidades en el contexto del bucle, el paso `cargar_habilidad`, y la siembra del catálogo y su activación por la puerta del Evaluador.
- `apps/platform-agents`: `catalogo/habilidades.json` y su esquema Zod.
- `packages/evals`: los casos dorados de cada habilidad y el de carga.

## Endpoints, flujos y datos

Sin endpoints, sin flujos nuevos, sin tablas ni migración. Reutiliza `habilidad`, `habilidad_version_puesto` y `habilidades_congeladas`, y la puerta de `packages/learning`.

## Criterios de hecho

1. Con una versión de puesto que tiene habilidades activas, el contexto de la tarea lleva una línea por habilidad (nombre y casos que aplican) y ningún cuerpo; sin habilidades, el contexto no cambia respecto a hoy.
2. `cargar_habilidad` con un nombre de la versión devuelve sus pasos y comprobaciones y deja la habilidad y su versión en la entrada de auditoría; con un nombre que no está en la versión devuelve un error y no carga nada.
3. Ningún paso de una habilidad se ejecuta con un nivel distinto del que la política da a esa clase de acción: un caso prueba que una habilidad que describe marcar una factura como dudosa no lo consigue en N1.
4. Cada una de las nueve habilidades tiene al menos tres casos dorados: uno donde aplica y se usa bien, uno donde no aplica y no debe cargarse, y uno donde la persona pide asesoramiento fiscal o legal y el agente declina y escala.
5. Una habilidad solo se activa si `certificarPromocion` la certifica; una que baja la certificación del puesto o que nombra una herramienta fuera de su lista blanca queda bloqueada y no crea versión de puesto.
6. Cada habilidad del catálogo cita al menos una fuente oficial cuando su contenido es normativo, y el PR lista qué cifra o fecha verificó el Constructor y contra qué texto.
7. Ninguna habilidad produce una comunicación a un tercero ni una acción de escritura por sí misma: preparan, comprueban y proponen.
8. La certificación de `cobros-001` y `conciliacion-001` no baja con las habilidades cargadas, y `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde.

## Casos de prueba y de eval

- Unitario: esquema del catálogo (campos obligatorios, una fuente cuando es normativa, sin herramienta fuera de la lista blanca); índice de contexto con cero, una y varias habilidades; `cargar_habilidad` con nombre válido, inválido y repetido; límite de tamaño del cuerpo cargado.
- Integración con PostgreSQL: siembra del catálogo, activación por la puerta, creación de la versión de puesto con las habilidades congeladas, reversión a la versión anterior; se salta sin `DATABASE_URL`.
- Eval: los casos del criterio 4 para las nueve habilidades, más `habilidad-carga-001` (el agente pide la habilidad que corresponde a la tarea y no otra). Contra el proveedor de pruebas en el humo y contra el proveedor real en el trabajo semanal, como los casos de Cobros y Conciliación.
- Auditoría y contador: la entrada de `cargar_habilidad` y la prueba de que no suma al contador.
- Secretos: ninguna credencial en el catálogo, en el índice ni en el cuerpo cargado; rastreo como el de `packages/models`.

## Fuera de alcance

- Que el agente proponga mejoras de sus propias habilidades: «El agente propone mejoras de sus propias habilidades como lecciones de clase habilidad» (Ciclo 3, Propuesta).
- Habilidades de Ventas y atención, Administración y del Director de IA.
- Editor de habilidades en el panel y habilidades escritas por el cliente.
- Asesoramiento fiscal, contable o legal, y cualquier decisión que hoy tome una persona.
- Añadir una columna de descripción a `habilidad`: sería una migración.

## Presupuesto de tokens

Presupuesto: 60 €. Es la mayor de las rebanadas del ciclo: mecanismo más nueve habilidades con sus casos dorados y verificación de fuentes. Si el Constructor la ve demasiado grande, la parte de contenido (el catálogo) puede separarse del mecanismo en dos PR, y lo dice en la ficha antes de empezar. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿Quién de Bitclick revisa el contenido normativo de las habilidades de Cobros y Previsión antes de activarlas con un cliente real? Ninguna habilidad da asesoramiento, pero una fecha fiscal o un interés de demora equivocados en una propuesta sí hacen daño.
