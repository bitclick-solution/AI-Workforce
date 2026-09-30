VIGENTE

# Runbook · Vertex AI UE, federación de identidades de GitHub y cambio de proveedor en una línea

Vertex AI UE está implementado y documentado detrás del puerto de
`@aiw/models`, pero **inactivo**: ni Bedrock ni Vertex conceden hoy cuota de
Opus 5.5/Sonnet 5 a la cuenta de Bitclick (ADR-023, revisado el 2026-09-29), así
que el cliente clásico de Bedrock UE sigue siendo el proveedor por defecto
(`docs/runbooks/modelos-funciones-ausentes.md`, `bedrock-iam-oidc.md`). Este
runbook deja escrito qué crear en Google Cloud y con qué forma, y el bloque de
comandos de Cloud Shell que verifica los tres modelos con una llamada real
—para el día que Google conceda la cuota, no para ejecutar ahora—. El
Constructor no crea nada de esto en Google Cloud ni pide ni ve ninguna clave.
También explica cómo cambiar de proveedor principal o de respaldo sin tocar
código, y cómo cambiar un modelo cuando salga uno nuevo en la multirregión
europea.

**Fuente de los datos de esta página**: `docs.claude.com/en/build-with-claude/claude-on-vertex-ai`
(comprobado el 2026-09-29). No se ha podido comprobar `docs.cloud.google.com`
en este entorno de desarrollo (bloqueado por la política de red, igual que
`docs.aws.amazon.com` en el runbook de Bedrock): si Google documenta algo
distinto para la multirregión `eu` o para la autenticación, esa página manda,
no esta.

## Los tres datos que pedía la rebanada, verificados en la documentación oficial

1. **Ubicación de la multirregión europea**: el identificador es `eu` (no
   `europe-west1` ni ningún otro nombre) — `region: "eu"` en el SDK, junto a
   `"us"` para la multirregión estadounidense. `AIW_VERTEX_REGION_UE=eu`
   activa esta multirregión; el paquete también acepta una región concreta
   `europe-*` (por ejemplo `europe-west1`) si Jesús prefiere una sola región
   en vez de la multirregión — `clienteVertexDesdeEntorno`
   (`packages/models/src/adaptadores/clientes.ts`) rechaza cualquier otra
   ubicación al arrancar (`comprobarResidenciaVertexUE`).
2. **URL base**: el SDK la calcula solo a partir de `region` — para `eu`,
   `https://aiplatform.eu.rep.googleapis.com`; para una región concreta como
   `europe-west1`, `https://europe-west1-aiplatform.googleapis.com`. No hace
   falta escribirla en ningún sitio: `AnthropicVertex({ projectId, region })`
   la resuelve.
3. **Garantía de residencia**: la documentación de Anthropic describe las
   multirregiones (`us`, `eu`) como pensadas para «residencia de datos dentro
   de una geografía amplia con alta disponibilidad», frente a los endpoints
   globales (sin residencia: enrutan a cualquier región con capacidad) y a los
   endpoints regionales (residencia en una sola región concreta). La
   multirregión `eu` reparte la inferencia entre varias regiones de la Unión
   Europea, nunca fuera de ella — el mismo nivel de garantía que los perfiles
   de inferencia UE de Bedrock (ADR-017). Los endpoints regionales y
   multirregionales llevan un recargo del 10 % sobre el endpoint global,
   según la misma documentación.

## Autenticación: sin clave de API, con credenciales de Google

El cliente de Vertex (`@anthropic-ai/vertex-sdk`, `AnthropicVertex`) se
autentica siempre por el flujo estándar de `google-auth-library` — credenciales
de aplicación por defecto (ADC) o cuenta de servicio. El constructor solo
admite `projectId` y `region`: **no tiene ningún parámetro de clave de API**, a
diferencia del cliente de primera parte de Anthropic. Esto es distinto de
Bedrock, cuyo SDK sí admite credenciales de acceso además de un rol asumido.

**La clave de API que ha generado Jesús no sirve para esta ruta y no debe
usarse aquí**: no la pegues en el `.env`, en ninguna variable de este job, en
un mensaje ni en un registro — el SDK de Vertex la ignoraría igualmente. Si
esa clave es para otro uso (por ejemplo, la API de primera parte o el modo
Express de Vertex, no usado por esta rebanada), guárdala donde corresponda a
ese uso, nunca aquí.

- **En local**: `gcloud auth application-default login` deja las credenciales
  de aplicación por defecto en el usuario de Jesús; el `.env` no lleva ninguna
  clave.
- **En producción**: una cuenta de servicio con el rol mínimo de la sección
  siguiente, cargada por el mecanismo estándar de credenciales de la carga de
  trabajo (cuenta de servicio adjunta a la máquina o
  `GOOGLE_APPLICATION_CREDENTIALS` apuntando al fichero de clave de esa
  cuenta, nunca en el repositorio).
- **En GitHub Actions**: sin clave guardada — la cuenta de servicio
  `aiw-ci-vertex` se asume por federación de identidades de carga de trabajo
  (WIF), la versión de Google Cloud de lo que Bedrock hace con OIDC.

## Pasos de Jesús en Google Cloud

Sustituye `<GCP_PROJECT_ID>` y `<GCP_PROJECT_NUMBER>` por los del proyecto de
Bitclick (`gcloud config get-value project` y
`gcloud projects describe <GCP_PROJECT_ID> --format='value(projectNumber)'`
los dan). Todo desde Cloud Shell o `gcloud` local con ese proyecto activo.

### 1. Vertex AI y los tres modelos, activados — sin cuota todavía

Confirmado por Jesús el 29-9-2026: proyecto con Vertex AI activado y Opus 5.5,
Sonnet 5 y Haiku 4.5 visibles en el Model Garden de Anthropic en la
multirregión europea. Activado no es lo mismo que con cuota: la cuenta no
tiene cuota concedida para invocarlos todavía, igual que Bedrock
(`docs/adr/ADR-023.md`). Nada que crear aquí — cuando Google conceda la cuota,
el bloque de comandos de la sección 5 lo confirma con una llamada real.

### 2. Grupo y proveedor de identidad de GitHub (WIF)

```bash
gcloud iam workload-identity-pools create "github-pool" \
  --project="<GCP_PROJECT_ID>" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="<GCP_PROJECT_ID>" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_id=='1377453835' && assertion.repository_owner_id=='301227888' && assertion.ref=='refs/heads/main'"
```

La condición de atributo usa los mismos identificadores inmutables que
`bedrock-iam-oidc.md` usa en el `sub` de AWS (`repository_id` 1377453835,
`repository_owner_id` 301227888 — públicos, visibles por cualquiera con acceso
a la API de GitHub): así, si el repositorio o la organización cambian de
nombre, la confianza sigue siendo válida. La condición ya limita el proveedor
a `main`: ni un `pull_request` ni un `workflow_dispatch` desde otra rama
pueden generar un token que la pase.

### 3. Cuenta de servicio `aiw-ci-vertex`, con el rol mínimo

```bash
gcloud iam service-accounts create aiw-ci-vertex \
  --project="<GCP_PROJECT_ID>" \
  --display-name="CI — invocar modelos de Vertex AI (solo main)"

# Rol mínimo predefinido de Google para invocar modelos de Vertex AI (incluye a
# los publicados por terceros en el Model Garden, como Anthropic). Antes de
# concederlo, ábrelo en IAM → Roles → busca "Vertex AI User" en la consola
# para comparar sus permisos con lo que de verdad hace falta: si Google ofrece
# un rol más estrecho para solo invocar predicción de modelos de partner, usa
# ese en su lugar, no este documento (mismo aviso de verificación que
# bedrock-iam-oidc.md: no se ha podido abrir docs.cloud.google.com desde este
# entorno).
gcloud projects add-iam-policy-binding "<GCP_PROJECT_ID>" \
  --member="serviceAccount:aiw-ci-vertex@<GCP_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts add-iam-policy-binding \
  "aiw-ci-vertex@<GCP_PROJECT_ID>.iam.gserviceaccount.com" \
  --project="<GCP_PROJECT_ID>" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/<GCP_PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/attribute.repository_id/1377453835"
```

Ningún otro permiso: nunca `roles/owner`, `roles/editor` ni
`roles/aiplatform.admin` para esta cuenta de servicio.

### 4. Variables de repositorio

**Settings → Secrets and variables → Actions → Variables** de este
repositorio:

| Variable                         | Valor                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AIW_VERTEX_REGION_UE`           | `eu`                                                                                                         |
| `AIW_VERTEX_PROJECT_ID`          | `<GCP_PROJECT_ID>`                                                                                           |
| `AIW_VERTEX_WIF_PROVIDER`        | `projects/<GCP_PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `AIW_VERTEX_WIF_SERVICE_ACCOUNT` | `aiw-ci-vertex@<GCP_PROJECT_ID>.iam.gserviceaccount.com`                                                     |

Ninguna es un secreto: sin la condición de atributo del paso 2, ninguna de
ellas sirve para nada fuera de una ejecución sobre `main` de este repositorio.
`ci.yml` ya tiene el job **Vertex UE · integración (manual, sin cuota)**, con
`permissions: id-token: write` y `google-github-actions/auth` asumiendo la
cuenta de servicio por federación de identidades. En cuanto exista
`AIW_VERTEX_WIF_PROVIDER`, ese job deja de decir «nada que probar» y ejecuta
`pnpm --filter @aiw/models test:integracion:vertex` y los dos casos dorados
reales de Cobros y Conciliación — solo al lanzarlo a mano desde la pestaña
**Actions**, sin cron semanal (a diferencia del de Bedrock): no tiene sentido
pagar una comprobación periódica de un proveedor sin cuota. Añadir el mismo
`schedule` que usa el job de Bedrock a `vertex-integracion` en `ci.yml` es el
único cambio cuando Google conceda la cuota.

### 5. Verificar los tres modelos con una llamada real (para cuando haya cuota)

**No ejecutar todavía**: sin cuota concedida, esta llamada falla con un error
de cuota o de acceso, no con nada que arreglar en el código. Queda aquí para
cuando Google la conceda — es el mismo bloque que cierra el criterio de hecho
pendiente «los identificadores se verifican con una llamada real, nunca de
memoria». Sustituye `<GCP_PROJECT_ID>` y ejecútalo desde Cloud Shell, con el
proyecto de Bitclick activo:

```bash
PROJECT_ID="<GCP_PROJECT_ID>"
LOCATION="eu"
TOKEN=$(gcloud auth print-access-token)

for MODEL_ID in claude-opus-5-5 claude-sonnet-5 "claude-haiku-4-5@20251001"; do
  echo "=== ${MODEL_ID} ==="
  curl -s "https://aiplatform.${LOCATION}.rep.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/anthropic/models/${MODEL_ID}:rawPredict" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{
      "anthropic_version": "vertex-2023-10-16",
      "messages": [{"role": "user", "content": "Responde solo: Pong"}],
      "max_tokens": 16
    }' | jq .
  echo
done
```

La salida no lleva secretos (solo el identificador del modelo y su respuesta):
puede pegarse tal cual en una sesión del Constructor para confirmar los tres
identificadores de `IDENTIFICADOR_VERTEX_UE` antes de darlos por buenos para
tráfico de un tenant real. Un `Pong` de cada modelo confirma el identificador y
la ubicación a la vez; un error de cuota confirma que sigue sin haberla.

## Cómo cambiar de proveedor principal (o de respaldo) en una línea

Todo lo que ve un puesto es `puertoAnthropicPrincipalDesdeEntorno(papel,
configuracion)` (`packages/models/src/proveedor.ts`), nunca
`clienteVertexDesdeEntorno`/`clienteBedrockDesdeEntorno` a mano. Esa función lee
`AIW_PROVEEDOR_MODELOS` (por defecto `bedrock-ue`, ADR-023 — sin cuota, Vertex
no sirve tráfico real todavía aunque se anule la variable):

```bash
# Por defecto: Bedrock clásico como principal (ninguna cuota concedida hoy).
AIW_PROVEEDOR_MODELOS=bedrock-ue

# Probar Vertex UE a mano (por ejemplo, en cuanto Google conceda la cuota, o
# para repetir el bloque de comandos de Cloud Shell de la sección 5 con el
# cliente real del paquete en vez de curl):
AIW_PROVEEDOR_MODELOS=vertex-ue
```

Lo mismo para el respaldo, con `AIW_PROVEEDOR_MODELOS_RESPALDO` (por defecto
`vertex-ue`). Ningún cambio de código en ninguno de los dos casos — solo la
variable de entorno del `.env` o del secreto de despliegue que corresponda.
`puertoAnthropicRespaldoDesdeEntorno` construye el puerto del proveedor de
respaldo con la misma firma: queda listo como bloque de construcción para
cuando una rebanada futura cablee la conmutación automática en el bucle del
agente.

Un valor que no sea `vertex-ue` ni `bedrock-ue` hace que `proveedor.ts` lance
al arrancar con el nombre exacto de la variable, el valor recibido y los
valores admitidos — nunca cae en silencio a un proveedor por defecto.

## Cómo cambiar un modelo cuando salga uno nuevo en la UE

Por ejemplo, cuando Sonnet 5.5 llegue a la multirregión europea (todavía no
está, comprobado el 2026-09-29 — ADR-023 lo señala explícitamente):

1. Confirma el identificador exacto y la disponibilidad regional en la tabla
   de identificadores de Agent Platform
   (`docs.claude.com/en/build-with-claude/claude-on-vertex-ai`) — con una
   llamada real desde el proyecto de Bitclick, no de memoria (repite el
   bloque de comandos de Cloud Shell de la sección 5, cambiando el
   identificador del modelo).
2. En `packages/models/src/identificadores.ts`, cambia una fila de
   `IDENTIFICADOR_VERTEX_UE` — por ejemplo, `sonnet5: 'claude-sonnet-5-5'` en
   vez de `'claude-sonnet-5'`. Ninguna otra tabla ni ningún otro archivo.
3. Actualiza las pruebas unitarias afectadas
   (`identificadores.test.ts`) al nuevo identificador.
4. Ningún cambio de versión de puesto: `opus5`/`sonnet5`/`haiku45` siguen
   siendo los mismos papeles — la versión de puesto nunca supo qué
   identificador real la servía (mismo principio que en
   `modelos-funciones-ausentes.md` para Bedrock).
5. Repite el criterio de hecho pendiente: los casos dorados de Cobros y
   Conciliación contra el proveedor real
   (`packages/evals/smoke/*-vertex.integracion.test.ts`) y la prueba de
   integración de `@aiw/models` en el job **Vertex UE · integración**.

## Qué no hacer

- No adjuntar `roles/owner`, `roles/editor` ni ningún rol amplio a
  `aiw-ci-vertex`.
- No guardar ninguna clave de la cuenta de servicio `aiw-ci-vertex`: se asume
  siempre por federación de identidades, nunca por clave.
- No usar la clave de API que ha generado Jesús en esta ruta: el SDK de
  Vertex no la admite y no debe aparecer en el `.env`, en un secreto de CI, en
  un mensaje ni en un registro.
- No ampliar la condición de atributo del proveedor de identidad más allá de
  `main`: en un PR, el intercambio de token debe fallar.
