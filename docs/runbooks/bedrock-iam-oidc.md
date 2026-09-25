VIGENTE

# Runbook · Política IAM mínima y confianza OIDC para Bedrock UE

Pasos para que Jesús cree, en su cuenta de AWS, los dos usuarios de IAM y el rol
que necesita `@aiw/models` para hablar con Bedrock en `eu-central-1` (decisión de
Jesús, 2026-09-25). El Constructor no crea nada de esto ni pide ni ve ninguna
clave: solo deja escrito qué crear y con qué forma.

**Aviso de verificación**: la acción exacta de IAM que usa el cliente Mantle de
Anthropic (`bedrock-mantle:CreateInference`, servicio "Amazon Bedrock Powered by
AWS Mantle") viene de una búsqueda hecha el 2026-09-25, no de la documentación
oficial de AWS: el acceso a `docs.aws.amazon.com` está bloqueado por la política
de red de este entorno de desarrollo. **Antes de crear la política, ábrela en el
editor visual de IAM** (`Create policy` → pestaña `JSON` para pegarla, o
`Visual editor` → servicio **"Bedrock Powered by AWS Mantle"** para ver sus
acciones y recursos tal como los conoce la consola) y compara: si la consola
ofrece una acción o un tipo de recurso distinto de los de aquí, usa lo que
diga la consola, no este documento.

## Los tres principales

| Principal        | Tipo           | Uso                                                              | Credencial                                                    |
| ---------------- | -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `aiw-dev`        | Usuario de IAM | Desarrollo local, en el `.env` de cada máquina                   | Clave de acceso (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) |
| `aiw-prod`       | Usuario de IAM | Producción (worker desplegado)                                   | Clave de acceso, nunca la misma que `aiw-dev`                 |
| `aiw-ci-bedrock` | Rol de IAM     | Job **Bedrock UE · integración** de `ci.yml` (nocturno o manual) | Ninguna guardada: se asume por OIDC en cada ejecución         |

Los tres llevan la misma política mínima de abajo; ninguno lleva ningún otro
permiso de la cuenta.

## Política IAM mínima (`AIWBedrockInvocarUE`)

Sustituye `<AWS_ACCOUNT_ID>` por el identificador de la cuenta. Un solo permiso:
invocar inferencia de Anthropic por el perfil de la UE, en cualquier región de
destino (Bedrock Mantle enruta la inferencia entre las regiones del perfil, así
que el recurso no se limita a `eu-central-1` sola):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvocarInferenciaAnthropicUE",
      "Effect": "Allow",
      "Action": "bedrock-mantle:CreateInference",
      "Resource": "arn:aws:bedrock-mantle:*:<AWS_ACCOUNT_ID>:project/*"
    }
  ]
}
```

Pasos:

1. **IAM → Policies → Create policy → JSON**, pega la política de arriba con el
   identificador de cuenta ya sustituido, nómbrala `AIWBedrockInvocarUE`.
2. Crea `aiw-dev` y `aiw-prod` como usuarios de IAM (**solo acceso mediante
   programación**, sin acceso a la consola), adjunta `AIWBedrockInvocarUE` a
   cada uno, y genera una clave de acceso por usuario.
3. Sigue con el rol `aiw-ci-bedrock` de la sección siguiente y adjúntale la
   misma política.
4. Primera invocación real: revisa CloudTrail para confirmar que
   `bedrock-mantle:CreateInference` es la única acción que aparece y que no hay
   ningún `AccessDenied` de una acción que falte. Si aparece uno, añade
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
   confianza — limitada a este repositorio, tal como pide la decisión de Jesús:

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
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:bitclick-solution/AI-Workforce:*"
           }
         }
       }
     ]
   }
   ```

   Para limitarlo más —por ejemplo, solo a ejecuciones sobre `main`— cambia el
   `StringLike` por `token.actions.githubusercontent.com:sub` igual a
   `repo:bitclick-solution/AI-Workforce:ref:refs/heads/main` con `StringEquals`
   en vez de `StringLike`. Con `workflow_dispatch` manual desde otra rama, esa
   condición más estrecha lo bloquearía; el `*` de arriba lo permite.

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
