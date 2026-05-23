ALTER TABLE "User" ADD COLUMN "username" TEXT;

WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN length(clean_username) >= 2 THEN clean_username
      ELSE 'user'
    END AS base_username
  FROM (
    SELECT
      id,
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]+', '-', 'g'),
          '^[^a-z0-9]+',
          '',
          'g'
        ),
        '[^a-z0-9]+$',
        '',
        'g'
      ) AS clean_username
    FROM "User"
  ) cleaned
),
ranked AS (
  SELECT
    id,
    base_username,
    count(*) OVER (PARTITION BY base_username) AS base_count
  FROM normalized
),
candidates AS (
  SELECT
    id,
    CASE
      WHEN base_count = 1 THEN regexp_replace(left(base_username, 32), '[^a-z0-9]+$', '', 'g')
      ELSE concat(
        regexp_replace(left(base_username, 23), '[^a-z0-9]+$', '', 'g'),
        '-',
        lower(left(id, 8))
      )
    END AS candidate_username
  FROM ranked
)
UPDATE "User" AS u
SET "username" = CASE
  WHEN length(c.candidate_username) >= 2 THEN c.candidate_username
  ELSE concat('user-', lower(left(u.id, 8)))
END
FROM candidates AS c
WHERE u.id = c.id;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
