import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

/**
 * Detects when schema.prisma has changes that aren't captured in a migration file.
 * This prevents the exact production outage from PR #106 where new columns were
 * added to the schema but no migration was generated — causing Prisma Client to
 * query columns that don't exist in the production database.
 *
 * Requires a shadow database (credentials_shadow) to exist locally.
 * CI creates it automatically; locally run:
 *   docker exec credentials-db psql -U credentials -c "CREATE DATABASE credentials_shadow;"
 */
describe('Prisma schema drift', () => {
  it('schema.prisma must be in sync with migration files', () => {
    const shadowUrl =
      process.env['SHADOW_DATABASE_URL'] ??
      'postgresql://credentials:credentials_dev_password@localhost:5433/credentials_shadow';

    let result: string;
    try {
      result = execSync(
        `npx prisma migrate diff ` +
          `--from-migrations prisma/migrations ` +
          `--to-schema-datamodel prisma/schema.prisma ` +
          `--shadow-database-url "${shadowUrl}" ` +
          `--exit-code`,
        { cwd: process.cwd(), encoding: 'utf-8', timeout: 60_000 },
      );
    } catch (err: any) {
      // exit-code != 0 means drift detected — stderr/stdout has the diff
      const output = (err.stdout ?? '') + (err.stderr ?? '');
      expect.fail(
        `Schema drift detected! schema.prisma has changes without a matching migration.\n` +
          `Run: npx prisma migrate dev --name <description>\n\n` +
          output,
      );
      return; // unreachable but satisfies TS
    }

    // exit code 0 — no drift
    expect(result).toContain('No difference detected');
  });
});
