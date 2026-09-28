VIGENTE

# Runbook · Política IAM mínima y confianza OIDC para Bedrock UE

Pasos para que Jesús cree y mantenga, en su cuenta de AWS, los dos usuarios de
IAM y el rol que necesita `@aiw/models` para hablar con Bedrock en la UE
(decisión de Jesús, 2026-09-25; camino clásico confirmado el 2026-09-28 — ver
`docs/runbooks/modelos-funciones-ausentes.md` para los dos caminos y por qué
`eu-north-1`). El Constructor no crea nada de esto ni pide ni ve ninguna clave:
solo deja escrito qué crear y con qué forma. Estado a 2026-09-28: la política de
abajo ya está aplicada por Jesús al rol `aiw-ci-bedrock`; aplícala también a
`aiw-dev` y `aiw-prod` si no la tienen, porque los tres usan hoy el mismo
cliente clásico.

**Fuente de la acción exacta**:

- `bedrock-mantle:CreateInference`, del servicio IAM "Amazon Bedrock Powered by
  AWS Mantle" (el prefijo que usa `AnthropicBedrockMantle` para invocar el
  endpoint de Mensajes), según el Service Authorization Reference de AWS
  (`https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html`,
  sección "Actions defined by Amazon Bedrock Powered by AWS Mantle") citado por
  la documentación pública de Anthropic sobre el cliente Mantle de Bedrock
  (`https://docs.claude.com/en/api/claude-on-amazon-bedrock`, apartado sobre
  permisos de IAM para el cliente Mantle). No se usa hoy (la cuenta no tiene
  acceso a ningún modelo de Anthropic por este camino en la UE), pero se deja
  concedida para cuando AWS lo conceda: así volver al endpoint de Mensajes no
  exige tocar IAM aparte.
- `bedrock:InvokeModel` y `bedrock:InvokeModelWithResponseStream`, del servicio
  IAM "Amazon Bedrock" (no "Bedrock Powered by AWS Mantle"), para el cliente
  clásico `AnthropicBedrock` (`bedrock-runtime`) que usa hoy el adaptador. Es la
  acción estándar de invocación de modelo de Bedrock, documentada en el mismo
  Service Authorization Reference (sección "Actions defined by Amazon
  Bedrock") y en la guía de Bedrock sobre permisos de invocación con perfiles
  de inferencia entre regiones.

**Aviso de verificación**: el acceso directo a `docs.aws.amazon.com` está
bloqueado por la política de red de este entorno de desarrollo, así que estas
citas vienen de búsquedas hechas el 2026-09-25 y el 2026-09-28, no de una
lectura directa de la página. **Antes de crear o ampliar la política, ábrela en
el editor visual de IAM** (`Create policy` → pestaña `JSON` para pegarla, o
`Visual editor` → servicio **"Bedrock"** o **"Bedrock Powered by AWS Mantle"**
según la sentencia, para ver sus acciones y recursos tal como los conoce la
consola) y compara con las páginas citadas arriba: si alguna ofrece una acción
o un tipo de recurso distinto de los de aquí, usa esa, no este documento.

## Los tres principales

| Principal        | Tipo           | Uso                                                              | Credencial                                                    |
| ---------------- | -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `aiw-dev`        | Usuario de IAM | Desarrollo local, en el `.env` de cada máquina                   | Clave de acceso (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) |
| `aiw-prod`       | Usuario de IAM | Producción (worker desplegado)                                   | Clave de acceso, nunca la misma que `aiw-dev`                 |
| `aiw-ci-bedrock` | Rol de IAM     | Job **Bedrock UE · integración** de `ci.yml` (nocturno o manual) | Ninguna guardada: se asume por OIDC en cada ejecución         |

Los tres llevan la misma política mínima de abajo; ninguno lleva ningún otro
permiso de la cuenta.

## Política IAM mínima (`AIWBedrockInvocarUE`)

Sustituye `<AWS_ACCOUNT_ID>` por el identificador de la cuenta. Dos sentencias:
invocar inferencia de Anthropic por el endpoint de Mensajes (sin usar hoy, ver
arriba) e invocar modelo por el camino clásico, limitado a los dos perfiles de
inferencia UE y a sus modelos base en regiones UE — nunca `bedrock:*` entero:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvocarInferenciaAnthropicUEMantle",
      "Effect": "Allow",
      "Action": "bedrock-mantle:CreateInference",
      "Resource": "arn:aws:bedrock-mantle:*:<AWS_ACCOUNT_ID>:project/*"
    },
    {
      "Sid": "InvocarModeloClasicoAnthropicUE",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:eu-north-1:<AWS_ACCOUNT_ID>:inference-profile/eu.anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:eu-north-1:<AWS_ACCOUNT_ID>:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:eu-*::foundation-model/anthropic.claude-sonnet-4-6",
        "arn:aws:bedrock:eu-*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      ]
    }
  ]
}
```

Los dos ARN de `foundation-model` (sin cuenta, con `eu-*` de comodín) hacen
falta porque un perfil de inferencia entre regiones invoca el modelo base en
cualquiera de las regiones de la UE que reparte el perfil, no solo en
`eu-north-1`: sin ellos, la invocación falla con `AccessDenied` sobre el
recurso del modelo base aunque el perfil esté permitido. Cuando la matriz
provisional de `identificadores.ts` cambie de modelo, actualiza los cuatro ARN
en el mismo cambio.

Pasos:

1. **IAM → Policies → Create policy → JSON**, pega la política de arriba con el
   identificador de cuenta ya sustituido, nómbrala `AIWBedrockInvocarUE`. Si ya
   existe con solo la primera sentencia (versión anterior de este runbook),
   añade la segunda como una nueva versión de la política.
2. Crea `aiw-dev` y `aiw-prod` como usuarios de IAM (**solo acceso mediante
   programación**, sin acceso a la consola), adjunta `AIWBedrockInvocarUE` a
   cada uno, y genera una clave de acceso por usuario.
3. Sigue con el rol `aiw-ci-bedrock` de la sección siguiente y adjúntale la
   misma política. **Ya aplicada** a `aiw-ci-bedrock` el 2026-09-28: si falta en
   `aiw-dev` o `aiw-prod`, replícala ahí para que el desarrollo local y la
   producción puedan usar el mismo cliente clásico.
4. Primera invocación real: revisa CloudTrail para confirmar que
   `bedrock:InvokeModel`/`InvokeModelWithResponseStream` (y, si se usa,
   `bedrock-mantle:CreateInference`) son las únicas acciones que aparecen y que
   no hay ningún `AccessDenied` de una acción que falte. Si aparece uno, añade
   exactamente esa acción a la política — nunca `bedrock-mantle:*` ni
   `bedrock:*` enteros.

## Rol `aiw-ci-bedrock` y confianza OIDC (sin claves guardadas)

GitHub Actions asume este rol con un token de identidad (OIDC), no con una clave
de acceso guardada como secreto — así, si el repositorio se filtra, no hay
ninguna clave de AWS de larga duración que revocar.

1. **Si la cuenta no tiene ya un proveedor de identidad de GitHub**: IAM →
   Identity providers → Add provider → OpenID Connect → URL del proveedor
   `https://token.actions.githubusercontent.com` → audiencia `sts.amazonaws.com`.
   (Una cuenta solo necesita este proveedor una vez, lo compartan o no otros
   repositorios.)
2. **IAM → Roles → Create role → Custom trust policy**, con esta relación de
   confianza — limitada a `main` (decisión de Jesús, 2026-09-25: en los PR no
   asume el rol, solo en ejecuciones sobre esa rama). El `sub` usa los
   identificadores inmutables que emite GitHub para la organización y el
   repositorio (`bitclick-solution@301227888` y `AI-Workforce@1377453835`), no
   sus nombres: así, si el repositorio o la organización cambian de nombre, la
   confianza sigue siendo válida sin tocar IAM. Esos números no son secretos —
   son identificadores públicos del repositorio, visibles por cualquiera con
   acceso a la API de GitHub—, así que pueden citarse tal cual en este runbook:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:bitclick-solution@301227888/AI-Workforce@1377453835:ref:refs/heads/main"
           }
         }
       }
     ]
   }
   ```

   Con esta condición, ni un `pull_request` ni un `workflow_dispatch` lanzado
   desde otra rama pueden asumir el rol — solo el cron semanal o un
   `workflow_dispatch` disparado con `main` como rama seleccionada, que es
   justo el job **Bedrock UE · integración** de `ci.yml`
   (`if: (github.event_name == 'schedule' || github.event_name ==
'workflow_dispatch') && github.ref == 'refs/heads/main'`).

3. Nómbralo `aiw-ci-bedrock`, adjúntale la política `AIWBedrockInvocarUE` de la
   sección anterior. Sin ningún otro permiso.
4. En **Settings → Secrets and variables → Actions → Variables** de este
   repositorio, crea `AWS_ROLE_ARN` con el ARN del rol
   (`arn:aws:iam::<AWS_ACCOUNT_ID>:role/aiw-ci-bedrock`). No es un secreto: un
   ARN de rol no sirve para nada sin la relación de confianza de arriba, así que
   no hace falta ocultarlo.
5. `ci.yml` ya tiene el job **Bedrock UE · integración**, con
   `permissions: id-token: write` y `aws-actions/configure-aws-credentials`
   asumiendo `AWS_ROLE_ARN` por OIDC. En cuanto exista la variable, ese job deja
   de decir «nada que probar» y ejecuta de verdad
   `pnpm --filter @aiw/models test:integracion:bedrock` en el cron nocturno o al
   lanzarlo a mano desde la pestaña **Actions**.

## Qué no hacer

- No adjuntar `AdministratorAccess`, `AmazonBedrockFullAccess` ni ninguna
  política gestionada amplia a ninguno de los tres principales.
- No guardar una clave de acceso de `aiw-ci-bedrock`: ese rol nunca tiene clave,
  solo se asume por OIDC.
- No compartir la clave de `aiw-dev` ni la de `aiw-prod` entre sí, ni pegarlas en
  el repositorio, en un PR, en un mensaje o en un registro.
