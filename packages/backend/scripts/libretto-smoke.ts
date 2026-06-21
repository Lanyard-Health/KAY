/**
 * Step 1 connectivity smoke test: prove the backend can call a deployed
 * Libretto workflow and read its result. Uses the non-PII `star-repo` workflow.
 *
 * Run:
 *   LIBRETTO_API_KEY=<key> npx tsx scripts/libretto-smoke.ts [workflow]
 */
import { runJob } from '../src/services/libretto-cloud.client.js';

const workflow = process.argv[2] ?? 'star-repo';

const job = await runJob(workflow, {}, { pollMs: 3000 });
console.log('status :', job.status);
console.log('job_id :', job.job_id);
console.log('result :', JSON.stringify(job.result ?? {}, null, 2));
