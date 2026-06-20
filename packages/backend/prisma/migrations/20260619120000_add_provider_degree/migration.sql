-- Provider's primary professional degree, mirrored from CAQH's top-level
-- <Degree> element. Nullable; populated by the CAQH sync.
ALTER TABLE "providers" ADD COLUMN "degree" "DegreeType";
