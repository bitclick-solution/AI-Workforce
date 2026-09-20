/**
 * HTML mínimo y escapado.
 *
 * El resumen legible de una aprobación lo escribe un agente a partir de datos de un
 * ERP: es texto que no controlamos, y sale tanto en el correo como en la página. Se
 * escapa siempre, en los dos sitios, sin excepciones y sin confiar en que «eso lo
 * genera la plataforma».
 *
 * No hay plantillas ni JavaScript: la página de aprobación tiene que abrirse en el
 * navegador de una persona que quizá esté en el móvil, con el correo de la empresa
 * y sin sesión. Un formulario y dos botones es todo lo que hace falta.
 */
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => ESCAPES[caracter] ?? caracter);
}

/** Estilo en línea, sin fichero aparte: una hoja de estilos sería otra petición. */
export const ESTILO = [
  'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
  'margin:0;padding:2rem 1rem;background:#f6f6f5;color:#1d1d1b;line-height:1.5}',
  'main{max-width:34rem;margin:0 auto;background:#fff;border:1px solid #e3e3e0;',
  'border-radius:8px;padding:1.75rem}',
  'h1{font-size:1.25rem;margin:0 0 1rem}',
  'dl{margin:1rem 0;display:grid;grid-template-columns:auto 1fr;gap:.35rem .75rem}',
  'dt{color:#6b6b66}dd{margin:0}',
  'blockquote{margin:1rem 0;padding:.85rem 1rem;background:#f6f6f5;',
  'border-left:3px solid #1d1d1b;border-radius:4px;white-space:pre-wrap}',
  '.acciones{display:flex;gap:.75rem;margin-top:1.5rem;flex-wrap:wrap}',
  'button{font:inherit;padding:.7rem 1.2rem;border-radius:6px;border:1px solid #1d1d1b;',
  'cursor:pointer}',
  'button.aprobar{background:#1d1d1b;color:#fff}',
  'button.rechazar{background:#fff;color:#1d1d1b}',
  'footer{margin-top:1.5rem;font-size:.85rem;color:#6b6b66}',
].join('');

/** Envuelve el contenido en un documento completo. El título ya viene escapado. */
export function documento(titulo: string, contenido: string): string {
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex,nofollow">',
    `<title>${titulo}</title>`,
    `<style>${ESTILO}</style>`,
    '</head>',
    '<body><main>',
    contenido,
    '</main></body></html>',
  ].join('');
}

/**
 * Cabeceras de toda respuesta HTML de la aprobación.
 *
 * `no-store` para que el resumen no quede en la caché de un navegador compartido;
 * `no-referrer` para que el token no viaje en el `Referer` si la página enlazara
 * fuera; y una política de contenido que no deja cargar nada de ningún sitio,
 * porque la página no carga nada.
 */
export const CABECERAS_HTML: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
});
