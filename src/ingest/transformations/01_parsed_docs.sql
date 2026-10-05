-- Streaming parse of new PDFs in the docs volume. Auto Loader (read_files) tracks files, so each file is parsed once.
-- allowOverwrites => true: a file that is uploaded again under the same name (new revision) is picked up and parsed again;
-- publish_tables keeps only the latest parse of every doc_id. The glob matches *.pdf and *.PDF (and mixed case);
-- doc_id is the file name without the extension, whatever its case.
-- ai_parse_document is pinned to version 2.0; page images go to the page_images volume.
CREATE OR REFRESH STREAMING TABLE parsed_docs
COMMENT 'ai_parse_document (version 2.0) output, one row per parse of a source PDF'
AS SELECT
  regexp_extract(path, '(?i)([^/]+)\\.pdf$', 1) AS doc_id,
  path AS file_path,
  sha2(content, 256) AS sha256,
  ai_parse_document(content, map('version', '2.0', 'imageOutputPath', '${images_path}')) AS parsed,
  current_timestamp() AS parsed_at
FROM STREAM read_files(
  '${docs_path}',
  format => 'binaryFile',
  pathGlobFilter => '*.[pP][dD][fF]',
  allowOverwrites => true
);
