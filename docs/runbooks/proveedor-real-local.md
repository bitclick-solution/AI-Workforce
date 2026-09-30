VIGENTE

# Runbook · Proveedor real de modelos: elegirlo en local y qué cuesta

Desde la rebanada «Proveedor real en el bucle del agente», los puestos de la plataforma deciden con un modelo real cuando el proceso lo pide. Este runbook explica cómo elegir el proveedor en local, qué pasa si falta algo y cuánto cuesta una tarea de Cobros. Decisiones de fondo: ADR-017 (residencia UE), ADR-018 (papeles, esfuerzo, respaldo y coste) y ADR-023 (Bedrock clásico y proveedor en una línea).

## Cómo se elige

Un solo valor, `AIW_PROVEEDOR_MODELOS`, decide con qué modelo trabaja cada proceso que hace decidir a un agente: el trabajador, `pnpm local:arrancar` y `pnpm --filter @aiw/worker bitclick:cobros`.

| Valor        | Qué hace                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prueba`     | Proveedor determinista. Sin claves, sin red, sin coste. Es el de la CI, los evals de humo, las pruebas y la demo local. **Solo se usa si lo escribes.** |
| `bedrock-ue` | Bedrock UE clásico en `eu-north-1`. Es el valor por defecto de un proceso sin variable, y necesita credenciales de AWS.                                 |
| `vertex-ue`  | Vertex UE. Implementado, inactivo hasta que Google conceda cuota (`vertex-wif.md`).                                                                     |

`AIW_PROVEEDOR_MODELOS_RESPALDO` dice a qué proveedor pasa un paso cuando el principal falla (por defecto `vertex-ue`). No hace falta tener sus credenciales para arrancar: se construye la primera vez que se necesita, y si entonces falta algo, el error lo dice.

> **Importante:** un proceso sin `AIW_PROVEEDOR_MODELOS` **no** cae al proveedor de prueba. Arranca con Bedrock y, si no encuentra credenciales, se niega a arrancar con un mensaje que nombra lo que falta. Es a propósito: un proceso que decide con un guion sin que nadie lo haya pedido mide un coste de 0 € y da por bueno lo que no lo es.

## Demo local: no cambia

`.env.example` trae `AIW_PROVEEDOR_MODELOS=prueba`, y `pnpm local:arrancar` pasa `prueba` al trabajador de la demo aunque tu `.env` sea anterior y la tenga vacía. La demo del viernes corre igual que antes, sin credenciales.

## Pasar a Bedrock en local

1. En tu `.env` (nunca en el repositorio, en un prompt ni en un mensaje), con las credenciales del usuario IAM `aiw-dev`:

   ```
   AIW_PROVEEDOR_MODELOS=bedrock-ue
   AIW_BEDROCK_REGION_UE=eu-north-1
   AWS_ACCESS_KEY_ID=<la tuya>
   AWS_SECRET_ACCESS_KEY=<la tuya>
   ```

   Con un perfil de AWS, `AWS_PROFILE` sustituye a las dos claves. Con credenciales por rol de instancia, `AIW_BEDROCK_CREDENCIALES_EXTERNAS=1`.

2. Los puestos ya sembrados apuntan todavía al proveedor de prueba. Deja al día el de Bitclick y sus tarifas (es repetible y no borra nada):

   ```powershell
   pnpm --filter @aiw/worker bitclick:sembrar
   ```

   Pone el enrutado por papel de la plantilla certificada en el puesto de Cobros y da de alta en el tenant las tarifas de Anthropic (Bedrock y Vertex UE) que falten. Sin tarifa, el trabajador se niega a llamar al modelo (`SinTarifa`): una llamada que no se puede cobrar no se hace.

3. Lanza la tarea como en `bitclick-cobros-odoo.md`, paso 6. Al arrancar, el trabajador imprime `proveedor de modelos: bedrock-ue (respaldo: vertex-ue)`. Si dice `prueba`, la variable no llegó.

Con la demo (`pnpm local:arrancar`) es igual: pon `AIW_PROVEEDOR_MODELOS=bedrock-ue` en `.env` y las tres variables de AWS. Los puestos que contrata la sala desde una frase ya salen con enrutado por papel; los de la semilla de la demo siguen con el guion de prueba.

## Qué pasa si algo falla

| Síntoma                                                                                 | Causa y qué hacer                                                                                                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| El proceso no arranca y dice «necesita credenciales de AWS».                            | Falta `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` (o `AWS_PROFILE`). O elige `AIW_PROVEEDOR_MODELOS=prueba`.                          |
| El proceso no arranca y dice «Falta AIW_BEDROCK_REGION_UE».                             | Pon `AIW_BEDROCK_REGION_UE=eu-north-1`.                                                                                                 |
| La tarea falla con `SinTarifa`.                                                         | Ejecuta `pnpm --filter @aiw/worker bitclick:sembrar`, o da de alta la tarifa con `registrarTarifa` (`packages/ledger`).                 |
| La tarea falla con «El proveedor «prueba» no está registrado… Registrados: bedrock-ue». | El puesto se sembró con el enrutado antiguo. Ejecuta `bitclick:sembrar` (Bitclick) o vuelve a elegir `prueba`.                          |
| La tarea falla con «El enrutado del puesto no es válido».                               | El puesto tiene `enrutado_modelo` vacío o sin papel. No se cae a ningún modelo por defecto: corrige la fila.                            |
| Un paso falla con error 403 de Bedrock y luego entra Vertex, o falla los dos.           | Sin acceso de la cuenta al modelo o sin cuota. El paso pasa una vez al proveedor de respaldo; si también falla, Temporal reintenta.     |
| La tarea falla con `RechazoDelClasificador`.                                            | El clasificador del proveedor rechazó la petición y el papel de respaldo del puesto también (o no tiene). Paso fallido no reintentable. |

## Qué se cobra y cómo se comprueba

Cada paso de modelo real suma al contador con los tokens que devuelve el proveedor, el **modelo que sirvió de verdad** y su plataforma, y la tarifa versionada del tenant (`tarifa_modelo`). Mientras Bedrock sirve `opus5` y `sonnet5` con Sonnet 4.6, se cobra la fila de `claude-sonnet-4-6`; `haiku45` cobra `claude-haiku-4-5`. Cuando llegue la cuota de la familia 5 basta cambiar la fila de `identificadores.ts` y el cobro sigue al modelo. Un intento que el clasificador rechaza antes de entrar el respaldo también se cobra, porque el proveedor lo factura.

Comprobación tras una tarea, con las consultas del contador (`bitclick-cobros-odoo.md`, pasos 8 y 9):

```powershell
pnpm --filter @aiw/worker bitclick:informe
```

y en la base, `select proveedor, modelo, plataforma, tokens_entrada, tokens_salida, coste_euros from uso_modelo order by creado_en desc limit 10`. `proveedor` es `anthropic`, `modelo` el que sirvió y `plataforma` `bedrock-eu` o `vertex-eu`. Si hay claves de Langfuse, el coste de cada tarea completada llega allí, por modelo.

## Coste esperado por tarea de Cobros

**Es una estimación, no una medida**: no hay ninguna tarea real de Cobros contra Bedrock todavía, y esta rebanada se construyó sin llamar a Bedrock. La primera semana de uso de Bitclick es la medida; este número se sustituye por ella.

Supuestos: Sonnet 4.6 en Bedrock UE (`opus5`/`sonnet5` hoy), razonamiento adaptativo con esfuerzo alto —el puesto ofrece una herramienta de escritura, así que sus pasos son de clase `decision_escritura`—, de tres a cinco pasos de modelo por tarea (listar, decidir las notas, cerrar), unos 3 000 tokens de entrada por paso (prompt, herramientas, facturas y resultados) y de 1 000 a 2 000 de salida por paso, razonamiento incluido. Tarifas del catálogo de desarrollo: 3,036 €/M de entrada y 15,18 €/M de salida.

| Escenario | Pasos | Entrada | Salida | Coste    |
| --------- | ----- | ------- | ------ | -------- |
| Bajo      | 3     | 9 000   | 3 000  | ≈ 0,07 € |
| Medio     | 4     | 12 000  | 6 000  | ≈ 0,13 € |
| Alto      | 5     | 15 000  | 10 000 | ≈ 0,20 € |

Espera **entre 0,07 € y 0,20 € por tarea**. Dos avisos:

- La plantilla hace una hipótesis de coste más baja (`eurosMesModelo: 4,5` para 180 tareas al mes, 0,025 € por tarea). Con estos supuestos queda entre tres y ocho veces por encima: la semana de uso de Bitclick dirá cuál acierta, y el informe semanal (`bitclick:informe`) la contrasta.
- El presupuesto por tarea de la plantilla es 0,5 €: el bucle corta antes del paso que lo superaría. Una tarea al día durante una semana son entre 0,5 € y 1,4 €.

## Por qué esta rebanada no probó contra Bedrock

La sesión que la construyó no tiene credenciales de AWS y no debe tenerlas. Todo lo que hay entre el bucle y la API está probado contra un servidor que imita la API de Mensajes, incluido el ciclo de dos vueltas con herramientas. Lo que solo prueba el servicio real —que Bedrock acepte el turno del asistente con su razonamiento devuelto tal cual y los resultados de herramienta en un solo mensaje— lo cubre el caso dorado nuevo «sonnet5 pide la herramienta y sigue en una segunda vuelta», que corre en el job **Bedrock UE · integración** (`ci.yml`, solo en `main`). Tras fusionar, Jesús lo lanza a mano desde la pestaña de acciones antes de fiarse del proveedor real.
