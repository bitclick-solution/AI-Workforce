REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `brand/README.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# `brand/` — la identidad en cascada de Bitclick

Este árbol es **la fuente de verdad** de la voz y de la guía visual (§16 de
`docs/plataforma.md`). Antes de la rodaja 12 cada blueprint llevaba su copia y
las copias derivaron; ahora hay una sola y los workers la compilan.

Cambiar cualquier cosa de aquí **es un PR**: diff visible, review e historial. Lo
que toca al nivel `org` entra además como **propuesta firmada (D11)**, porque
afecta a todos los departamentos a la vez y hay que ver a quién impacta antes de
aprobarlo.

## El mapa

```
brand/
├── org/
│   ├── voice.md          la voz de la casa — la hereda TODO worker
│   └── visual.yaml       los tokens (paleta, estilo de imagen) + la allowlist
├── departments/
│   ├── marketing_ventas/voice.md
│   └── operaciones/voice.md
└── channels/
    ├── instagram.yaml    override visual del canal (SOLO lo que cambia)
    └── linkedin.md       reglas de canal
```

El nivel `worker` **no está aquí**: `worker-rules.md` vive en cada blueprint
(`blueprints/<x>/brand/worker-rules.md`) porque describe el oficio del puesto,
no la marca. El compilador lo concatena al final.

El nivel `account` (la marca del cliente en workers multi-cuenta) todavía no
existe: se recorre y no encuentra fichero, que es exactamente la herencia.

## Qué toca cada nivel

| Nivel        | Fichero                                        | Qué define                                | Quién lo edita                          |
| ------------ | ---------------------------------------------- | ----------------------------------------- | --------------------------------------- |
| `org`        | `org/voice.md`, `org/visual.yaml`              | la voz y los tokens de Bitclick           | propuesta firmada (D11)                 |
| `department` | `departments/<clave>/voice.md`                 | lo que cambia en ese departamento         | el responsable del departamento, por PR |
| `channel`    | `channels/<canal>.md`, `channels/<canal>.yaml` | cómo se escribe y se compone en ese canal | quien lleva el canal, por PR            |
| `worker`     | `blueprints/<x>/brand/worker-rules.md`         | el oficio del puesto                      | quien mantiene el blueprint             |

Orden de resolución, de general a específico: **org → department → channel →
worker**. En prosa, «ganar» es ir después: el modelo lee la regla vigente la
última. En tokens, ganar es sobreescribir esa clave y solo esa.

Un departamento sin fichero hereda `org` pelado, y eso no es un error: es la
herencia funcionando. El departamento transversal `gabinete` es justo ese caso.

## La regla de sutileza

Un nivel de abajo **solo puede escribir las claves que el nivel de arriba le ha
permitido**. La lista vive en `overridable:` dentro de `org/visual.yaml` y el
compilador la aplica:

- `channel` puede tocar `palette.accent` e `image_style`.
- `department` puede tocar `tone_adjustments`.
- `palette.ground` y `palette.primary` **no están en ninguna lista**. Esa
  ausencia es la decisión, no un olvido.

Si un fichero escribe una clave que no le corresponde, el compilador lanza
`SutilezaViolada` y **el worker no arranca**. No es un warning: una marca a
medias que se ignora en silencio es peor que una que no compila.

> «La regla de sutileza es gobernanza, no estética: así "sutilmente naranja en
> IG" no puede degenerar en "otra marca en IG".»

## Cómo se consume

```python
from iagent_packs import resolver

pack = resolver(
    "org/bitclick/department/marketing_ventas/worker/bionica",
    canal="instagram",
    arbol=ruta_de_este_arbol,
    worker_dir=ruta_del_blueprint / "brand",
)
pack.voice_md          # la prosa concatenada, org -> department -> channel -> worker
pack.visual["palette"] # {'ground': '#000000', 'primary': '#00FF66', 'accent': '#FF9E00'}
pack.niveles_usados    # ('org', 'department', 'channel', 'worker')
pack.huella_sha256     # 'sha256:...' — misma entrada, misma huella
```

El compilador es `libs/iagent_packs/`. Sus tests (`libs/iagent_packs/tests/`)
son la especificación ejecutable de todo lo de arriba, incluido el caso
fundacional: en Instagram el acento es `#FF9E00`; en LinkedIn sigue siendo
`#FFDE00`.
