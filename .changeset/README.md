# Changesets

Cada rebanada que cambie el comportamiento de un paquete añade un changeset con `pnpm changeset`. El fichero describe el cambio para las notas de versión; `pnpm version-packages` agrupa los changesets pendientes y actualiza versiones y CHANGELOG.

Los paquetes son privados: los changesets sirven para versionar el bundle on-premise y las imágenes, no para publicar en npm.
