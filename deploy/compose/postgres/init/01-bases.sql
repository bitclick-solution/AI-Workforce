-- Se ejecuta solo la primera vez que se crea el volumen de PostgreSQL.
-- Temporal crea sus propias bases (temporal y temporal_visibility) al arrancar.
CREATE DATABASE aiworkforce;
CREATE DATABASE langfuse;

\connect aiworkforce
CREATE EXTENSION IF NOT EXISTS vector;
