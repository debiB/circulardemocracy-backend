-- Fix find_similar_campaigns function to match actual column types
-- The campaigns table uses VARCHAR(255) for name, slug, status
-- but the function was returning text, causing type mismatch errors

DROP FUNCTION IF EXISTS find_similar_campaigns(vector(1024), float, int);

CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.1,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  id int,
  name varchar(255),
  slug varchar(255),
  status varchar(20),
  reference_vector vector(1024),
  similarity float
)
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.slug,
    c.status,
    c.reference_vector,
    (1 - (c.reference_vector <-> query_embedding)) as similarity
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL 
    AND c.status IN ('active', 'unconfirmed')
    AND (1 - (c.reference_vector <-> query_embedding)) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT match_limit;
END;
$$ LANGUAGE plpgsql;
