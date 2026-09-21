REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-020.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-020 — Editar la marca en el panel es proponer un PR, nunca escribir

Fecha: 2026-09-19 · Estado: aceptada · Rodaja: 15 (B4)

## Contexto

Desde la rodaja 12 la identidad vive en `brand/` en git y ADR-017 dejó el
candado en prosa: «cambiar esto es una propuesta firmada (D11), no un
commit» — pero el flujo real empuja a main directo y el panel no puede ni
mirar el árbol. El §16 exige las dos cosas a la vez: «La organización
edita la suya en Mission Control» y «tocar la voz de la organización …
entra como propuesta (D11) y muestra a quién impacta antes de aprobarse».

## Decisión

1. **Git sigue siendo el ÚNICO origen de escritura.** El panel jamás
   escribe en el árbol ni en las filas materializadas: escribe una
   PROPUESTA. El Control API tampoco: su único acto de escritura externa
   es crear una rama y abrir un PR cuando la propuesta se firma.
2. **El circuito es el D11 que ya existe**: editar un fichero de `brand/`
   en Mission Control crea una `mc_proposal` (kind `brand.edit`, dedupe:
   UNA pendiente por fichero) con el contenido propuesto, el resumen y el
   IMPACTO — qué workers heredan el nivel tocado, calculado del registro
   y de `brand/consumers.yaml`. La firma del operador ejecuta el dominio:
   rama `panel/brand-<id>` + commit + PR contra main. El apunte de
   auditoría lleva la URL del PR; el fallo del ejecutor es
   `proposal.failed`, el tercer apunte de siempre.
3. **El compilador es la puerta de entrada, no solo la de salida**: la
   propuesta se compila ANTES de entrar en la bandeja, superponiendo el
   contenido propuesto sobre el árbol que la imagen ya lleva
   (`/srv/brand`, rodaja 12). `SutilezaViolada` o cualquier error del
   compilador es un `422` con el mensaje educativo tal cual — una
   propuesta que rompería el build no llega ni a proponerse.
4. **El merge del PR es humano y queda fuera del circuito.** La firma
   D11 dice «quiero este cambio»; el merge dice «git lo acepta ahora».
   Son dos actos a propósito: el segundo hereda toda la maquinaria real
   (CI, conflictos con main, revert). Al mergear, el deploy de siempre
   rematerializa los packs y el cambio llega a los ocho workers.
5. **El token de GitHub es de mínimo alcance**: fine-grained, SOLO este
   repo, SOLO contents y pull_requests en escritura (`MC_GITHUB_TOKEN`).
   Sin token configurado, aprobar un `brand.edit` es `503` y la
   propuesta queda pendiente — una dependencia ausente no se firma sola.
6. **Solo EDITAR ficheros existentes en esta rodaja.** Crear o borrar
   niveles del árbol (un departamento nuevo, un canal nuevo) es otra
   conversación: toca allowlists y registro, y entra cuando haya un caso
   real, no antes.
7. **Alcance: operador.** La edición de nivel cuenta/cliente por el
   tenant llega con la Plantilla IA y el ADR del nivel cuenta, por este
   mismo circuito.

## Consecuencias

- El contenido del panel sale del árbol QUE LA IMAGEN LLEVA (el commit
  desplegado). Si main avanzó desde el deploy, el PR puede llevar
  conflicto — y lo enseña GitHub, que es su trabajo (punto 4).
- Dos personas no pueden proponer sobre el mismo fichero a la vez
  (dedupe D11): la segunda ve la propuesta pendiente de la primera.
- El OS gana su primera escritura hacia un sistema externo con
  credencial propia; por eso el punto 5 es estricto y por eso el
  ejecutor se revisa con pasada de seguridad dedicada en la construcción.
